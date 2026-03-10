import { createAgentSession } from "@pi-bun-effect/agent";
import type { AgentMessage } from "@pi-bun-effect/core";
import type {
  LlmEvent,
  LlmModelId,
  LlmOptions,
  LlmProvider,
  LlmStreamResult,
} from "@pi-bun-effect/llm";
import { createSessionStore } from "@pi-bun-effect/session";
import { createToolRegistry, type ToolInvocation } from "@pi-bun-effect/tools";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function userMessage(id: string, text: string): AgentMessage {
  return {
    type: "user",
    role: "user",
    id,
    timestamp: new Date().toISOString(),
    content: [{ type: "text", text }],
  };
}

class ScriptedProvider implements LlmProvider {
  constructor(private readonly script: (context: AgentMessage[]) => LlmEvent[]) {}

  async configure(): Promise<void> {}

  async modelRegistry(): Promise<LlmModelId[]> {
    return [{ provider: "openai", modelId: "gpt-4o-mini" }];
  }

  stream(
    _model: LlmModelId,
    context: AgentMessage[],
    _options?: LlmOptions,
  ): LlmStreamResult {
    const events = this.script(context);
    async function* emit(): AsyncGenerator<LlmEvent> {
      for (const event of events) {
        yield event;
      }
    }
    return { stream: emit() };
  }

  async complete(): Promise<AgentMessage> {
    throw new Error("not used in integration tests");
  }
}

test("integration: real turn flow streams and persists assistant output", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-integration-"));
  const sessionPath = join(root, "session.jsonl");
  const store = createSessionStore();

  const provider = new ScriptedProvider(() => [
    { type: "start", payload: "start" },
    { type: "text_delta", payload: "hello" },
    { type: "text_delta", payload: " world" },
    { type: "done", payload: "done" },
  ]);

  const session = await createAgentSession({
    sessionId: "integration-stream",
    contextWindowTokens: 4096,
    reserveTokens: 256,
    autoCompaction: true,
    sessionStore: store,
    sessionPath,
    llmProvider: provider,
  });

  const events: string[] = [];
  session.onEvent((event) => {
    events.push(event.type);
  });

  const turn = await session.prompt({ message: userMessage("u1", "hi") });
  const entries = await store.readAll(sessionPath);

  expect(turn.events.some((event) => event.type === "text_delta")).toBeTrue();
  expect(events.includes("done")).toBeTrue();
  expect(entries.at(0)?.type).toBe("user");
  expect(entries.at(1)?.type).toBe("assistant");
  expect(entries.at(1)?.data.content.at(0)?.text).toBe("hello world");
});

test("integration: tool call executes, appends result, and continues generation", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-integration-"));
  const sessionPath = join(root, "session.jsonl");
  const store = createSessionStore();
  const tools = createToolRegistry();

  tools.register({
    name: "echo",
    description: "echo input",
    async run(_context, invocation: ToolInvocation) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: `tool-${Date.now()}`,
          timestamp: new Date().toISOString(),
          toolCallId: "call-1",
          toolName: invocation.name,
          content: [{ type: "text", text: String(invocation.input.value ?? "") }],
        },
      };
    },
  });

  const provider = new ScriptedProvider((context) => {
    const hasToolResult = context.some((message) => message.type === "toolResult");
    if (!hasToolResult) {
      return [
        { type: "start", payload: "start" },
        { type: "toolcall_start", payload: "echo" },
        {
          type: "toolcall_delta",
          payload: JSON.stringify({ name: "echo", input: { value: "from-tool" } }),
        },
        {
          type: "toolcall_end",
          payload: JSON.stringify({ name: "echo", input: { value: "from-tool" } }),
        },
      ];
    }

    return [
      { type: "start", payload: "resume" },
      { type: "text_delta", payload: "tool complete" },
      { type: "done", payload: "done" },
    ];
  });

  const session = await createAgentSession({
    sessionId: "integration-tools",
    contextWindowTokens: 4096,
    reserveTokens: 256,
    autoCompaction: true,
    sessionStore: store,
    sessionPath,
    llmProvider: provider,
    toolRegistry: tools,
  });

  await session.prompt({ message: userMessage("u1", "run tool") });
  const entries = await store.readAll(sessionPath);

  expect(entries.some((entry) => entry.type === "toolResult")).toBeTrue();
  expect(entries.some((entry) => entry.type === "assistant")).toBeTrue();
  expect(entries.at(-1)?.data.content.at(0)?.text).toBe("tool complete");
});

test("integration: compaction triggers at token boundary and writes summary entry", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-integration-"));
  const sessionPath = join(root, "session.jsonl");
  const store = createSessionStore();

  const provider = new ScriptedProvider(() => [
    { type: "start", payload: "start" },
    { type: "text_delta", payload: "short response" },
    { type: "done", payload: "done" },
  ]);

  const session = await createAgentSession({
    sessionId: "integration-compaction",
    contextWindowTokens: 12,
    reserveTokens: 2,
    autoCompaction: true,
    sessionStore: store,
    sessionPath,
    llmProvider: provider,
  });

  await session.prompt({
    message: userMessage("u1", "This user message is intentionally long to cross token budget."),
  });

  const entries = await store.readAll(sessionPath);
  const compaction = entries.find((entry) => entry.type === "compactionSummary");

  expect(compaction).toBeDefined();
  expect(compaction?.data.content.at(0)?.text.includes("Compacted")).toBeTrue();
  expect(entries.at(-1)?.type).toBe("compactionSummary");
});
