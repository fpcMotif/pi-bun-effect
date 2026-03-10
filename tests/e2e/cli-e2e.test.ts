import { runCli } from "@pi-bun-effect/cli";
import type { AgentMessage } from "@pi-bun-effect/core";
import type { RpcRequest } from "@pi-bun-effect/rpc";
import { expect, test } from "bun:test";

async function captureConsole<T>(fn: () => Promise<T>): Promise<{
  output: string[];
  result: T;
}> {
  const output: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    output.push(args.join(" "));
  };

  try {
    const result = await fn();
    return { output, result };
  } finally {
    console.log = original;
  }
}

function userMessage(text: string): AgentMessage {
  return {
    type: "user",
    role: "user",
    id: `rpc-${text}`,
    timestamp: new Date().toISOString(),
    content: [{ type: "text", text }],
  };
}

test("e2e: cli usage modes boot and respond with expected startup semantics", async () => {
  const help = await captureConsole(() => runCli(["--help"]));
  expect(help.result).toBe(0);
  expect(help.output.join("\n")).toContain("Usage:");

  const json = await captureConsole(() =>
    runCli(["--mode", "json", "--prompt", "ping", "--stream"])
  );
  expect(json.result).toBe(0);
  const jsonPayload = JSON.parse(json.output.at(-1) ?? "{}");
  expect(jsonPayload).toHaveProperty("type", "json_response");
  expect(jsonPayload).toHaveProperty("prompt", "ping");
  expect(jsonPayload).toHaveProperty("sandboxMode", "local");
});

test("e2e: cli rpc mode supports correlation-aware request/response", async () => {
  const process = Bun.spawn({
    cmd: ["bun", "run", "packages/cli/src/main.ts", "--mode", "rpc"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const request = JSON.stringify(
    {
      id: "rpc-1",
      command: "prompt",
      payload: { message: userMessage("hello") },
    } satisfies RpcRequest,
  );
  const query = JSON.stringify({
    id: "rpc-2",
    command: "get_state",
  });
  process.stdin?.write(`${request}\n`);
  process.stdin?.write(`${query}\n`);
  process.stdin?.end();

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  const lines = stdoutText.split(/\r?\n/).filter(Boolean);
  const responses = lines
    .map((line) => {
      try {
        return JSON.parse(line) as {
          id?: string;
          command?: string;
          status?: string;
        };
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);

  const prompt = responses.find((entry) => entry?.id === "rpc-1");
  const state = responses.find((entry) => entry?.id === "rpc-2");

  expect(prompt).toBeDefined();
  expect(state).toBeDefined();
  expect(prompt?.status).toBe("ok");
  expect(prompt?.command).toBe("prompt");
  expect(state?.command).toBe("get_state");
  expect(exitCode).toBe(0);
  expect(stderrText).toBe("");
});


test("e2e: cli rpc mode accepts sandbox mode override for bash command", async () => {
  const process = Bun.spawn({
    cmd: [
      "bun",
      "run",
      "packages/cli/src/main.ts",
      "--mode",
      "rpc",
      "--sandbox-mode",
      "containerized",
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const request = JSON.stringify({
    id: "rpc-bash-1",
    command: "bash",
    payload: { command: "echo hi", sandboxMode: "subprocess-isolated" },
  });
  process.stdin?.write(`${request}\n`);
  process.stdin?.end();

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  const response = stdoutText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id?: string; result?: { sandboxMode?: string } })
    .find((line) => line.id === "rpc-bash-1");

  expect(response).toBeDefined();
  expect(response?.result?.sandboxMode).toBe("subprocess-isolated");
  expect(exitCode).toBe(0);
  expect(stderrText).toBe("");
});
