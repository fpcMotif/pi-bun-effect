import { runCli } from "@pi-bun-effect/cli";
import type { AgentMessage } from "@pi-bun-effect/core";
import type { RpcCommandName, RpcRequest } from "@pi-bun-effect/rpc";
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

test("e2e: cli rpc mode supports required rpc command set", async () => {
  const process = Bun.spawn({
    cmd: ["bun", "run", "packages/cli/src/main.ts", "--mode", "rpc"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const commands: Array<{ command: RpcCommandName; payload?: RpcRequest["payload"] }> = [
    { command: "prompt", payload: { message: userMessage("hello") } },
    { command: "steer", payload: { message: userMessage("steer") } },
    { command: "follow_up", payload: { message: userMessage("follow") } },
    { command: "get_state" },
    { command: "get_messages" },
    { command: "set_model", payload: { provider: "openai", modelId: "gpt-4o" } },
    { command: "cycle_model" },
    { command: "get_available_models" },
    { command: "set_thinking_level", payload: { level: "high" } },
    { command: "cycle_thinking_level" },
    { command: "set_steering_mode", payload: { mode: "interrupt" } },
    { command: "set_follow_up_mode", payload: { mode: "replace" } },
    { command: "compact" },
    { command: "set_auto_compaction", payload: { enabled: false } },
    { command: "set_auto_retry", payload: { enabled: true } },
    { command: "abort_retry" },
    { command: "bash", payload: { command: "echo hi" } },
    { command: "new_session" },
    { command: "switch", payload: { sessionId: "session-custom" } },
    { command: "fork" },
    { command: "tree_navigation", payload: { action: "parent" } },
  ];

  commands.forEach((entry, index) => {
    const request: RpcRequest = {
      id: `rpc-${index + 1}`,
      command: entry.command,
      payload: entry.payload,
    };
    process.stdin?.write(`${JSON.stringify(request)}\n`);
  });

  process.stdin?.write(
    `${JSON.stringify({ id: "rpc-invalid", command: "set_model", payload: {} })}\n`,
  );
  process.stdin?.write(
    `${JSON.stringify({ id: "rpc-abort", command: "abort" satisfies RpcCommandName })}\n`,
  );
  process.stdin?.end();

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  const responses = stdoutText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as {
          id?: string;
          command?: string;
          status?: string;
          result?: { error?: { correlationId?: string } };
        };
      } catch {
        return undefined;
      }
    })
    .filter((line) => line?.id);

  commands.forEach((_entry, index) => {
    const id = `rpc-${index + 1}`;
    const response = responses.find((candidate) => candidate?.id === id);
    expect(response).toBeDefined();
    expect(response?.status).toBe("ok");
    expect(response?.id).toBe(id);
  });

  const invalid = responses.find((entry) => entry?.id === "rpc-invalid");
  expect(invalid?.status).toBe("error");
  expect(invalid?.result?.error?.correlationId).toBe("rpc-invalid");

  const aborted = responses.find((entry) => entry?.id === "rpc-abort");
  expect(aborted?.status).toBe("ok");
  expect(exitCode).toBe(0);
  expect(stderrText).toBe("");
});
