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
});

test("e2e: cli rpc mode supports correlation-aware request/response", async () => {
  const child = Bun.spawn({
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
  child.stdin?.write(`${request}\n`);
  child.stdin?.write(`${query}\n`);
  child.stdin?.end();

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
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

test("e2e: interactive mode supports slash command help and @ file autocomplete", async () => {
  const child = Bun.spawn({
    cmd: ["bun", "run", "packages/cli/src/main.ts", "--mode", "interactive"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });

  child.stdin?.write("/help\n");
  child.stdin?.write("please inspect @packages/cli/src\n");
  child.stdin?.write("/exit\n");
  child.stdin?.end();

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderrText).toBe("");
  expect(stdoutText).toContain("commands: /help, /exit, /files <query>");
  expect(stdoutText).toContain("assistant> echo: please inspect @packages/cli/src");
  expect(stdoutText).toContain("file suggestions (packages/cli/src)");
  expect(stdoutText).toContain("packages/cli/src/index.ts");
  expect(stdoutText).toContain("bye");
});
