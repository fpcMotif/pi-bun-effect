import { createAgentSession, InMemoryAgentSession } from "@pi-bun-effect/agent";
import type { AgentMessage } from "@pi-bun-effect/core";
import { createMockLlmProvider } from "@pi-bun-effect/llm";
import type { LlmModelId } from "@pi-bun-effect/llm";
import { createSessionStore } from "@pi-bun-effect/session";
import { createToolRegistry } from "@pi-bun-effect/tools";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assistantMessage(id: string, text: string): AgentMessage {
  return {
    type: "assistant",
    role: "assistant",
    id,
    timestamp: new Date().toISOString(),
    model: "test-model",
    content: [{ type: "text", text }],
  };
}

function userMessage(id: string, text: string): AgentMessage {
  return {
    type: "user",
    role: "user",
    id,
    timestamp: new Date().toISOString(),
    content: [{ type: "text", text }],
  };
}

test("integration: fake llm stream emits deterministic event order", async () => {
  const events = createMockLlmProvider([
    { type: "start", payload: "stream-start" },
    { type: "text_delta", payload: "intro" },
    { type: "toolcall_start", payload: "tool:read" },
    {
      type: "toolcall_delta",
      payload: JSON.stringify({
        name: "read",
        input: { path: "/tmp/path" },
      }),
    },
    {
      type: "toolcall_end",
      payload: JSON.stringify({
        name: "read",
        input: { path: "/tmp/path" },
      }),
    },
    { type: "done", payload: "complete" },
  ]).stream({
    provider: "openai",
    modelId: "gpt-4o",
  } as LlmModelId, []);

  const types: string[] = [];
  const payloads: string[] = [];
  for await (const event of events.stream) {
    types.push(event.type);
    payloads.push(event.payload ?? "");
  }

  expect(types).toEqual([
    "start",
    "text_delta",
    "toolcall_start",
    "toolcall_delta",
    "toolcall_end",
    "done",
  ]);
  expect(JSON.parse(payloads[3]!).name).toBe("read");
});

test("integration: session tool call is executed and generation continues", async () => {
  const toolRegistry = createToolRegistry();
  toolRegistry.register({
    name: "echo",
    description: "echoes text",
    async run(_context, invocation) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: "tool-result-1",
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: "call-static",
          toolName: "echo",
          content: [
            {
              type: "text",
              text: String(invocation.input.text ?? ""),
            },
          ],
        },
      };
    },
  });

  let streamCallCount = 0;
  const llmProvider = createMockLlmProvider([]);
  llmProvider.stream = () => {
    streamCallCount += 1;
    async function* emitter() {
      if (streamCallCount === 1) {
        yield { type: "start", payload: "" };
        yield { type: "text_delta", payload: "thinking" };
        yield { type: "toolcall_start", payload: "call-1" };
        yield {
          type: "toolcall_delta",
          payload: JSON.stringify({ name: "echo", input: { text: "ok" } }),
        };
        yield {
          type: "toolcall_end",
          payload: JSON.stringify({ name: "echo", input: { text: "ok" } }),
        };
        yield { type: "done", payload: "" };
        return;
      }
      yield { type: "start", payload: "" };
      yield { type: "text_delta", payload: "final" };
      yield { type: "done", payload: "" };
    }

    return {
      stream: emitter(),
    };
  };

  const session = new InMemoryAgentSession(
    {
      sessionId: "integration-tools",
      contextWindowTokens: 4096,
      reserveTokens: 128,
      autoCompaction: false,
    },
    {
      llmProvider,
      toolRegistry,
      model: { provider: "openai", modelId: "gpt-4o-mini" },
    },
  );

  const types: string[] = [];
  session.onEvent((event) => {
    types.push(event.type);
  });

  const result = await session.prompt({ message: userMessage("u-tools", "call") });

  expect(streamCallCount).toBe(2);
  expect(types).toContain("toolcall_start");
  expect(types).toContain("toolcall_end");
  expect(result.events.at(-1)?.type).toBe("done");
});

test("integration: compact preserves tool boundaries and writes metadata", async () => {
  const llmProvider = createMockLlmProvider([
    { type: "start", payload: "" },
    { type: "text_delta", payload: "assistant-1" },
    { type: "done", payload: "" },
  ]);

  const session = new InMemoryAgentSession(
    {
      sessionId: "integration-compact",
      contextWindowTokens: 4096,
      reserveTokens: 128,
      autoCompaction: false,
    },
    { llmProvider },
  );

  const internals = session as unknown as { messages: AgentMessage[] };
  internals.messages.push(
    assistantMessage("a1", "a1"),
    {
      type: "toolResult",
      role: "tool",
      id: "t1",
      parentId: "a1",
      timestamp: new Date().toISOString(),
      toolCallId: "call-a1",
      toolName: "echo",
      content: [{ type: "text", text: "tool" }],
    },
    userMessage("u2", "u2"),
    assistantMessage("a2", "a2"),
  );

  await session.compact();

  const summary = internals.messages[0];
  expect(summary?.type).toBe("compactionSummary");
  expect(summary?.content[0]?.text).toContain("compactionRun");

  const hasDanglingTool = internals.messages.some((message, index, all) => {
    if (message.type !== "toolResult") return false;
    return !all.slice(0, index).some((candidate) => candidate.id === message.parentId);
  });

  expect(hasDanglingTool).toBeFalse();
});

test("integration: session state, branching, and queue consistency", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-integration-"));
  const path = join(root, "session.jsonl");
  const store = createSessionStore();
  const first = await store.append(path, {
    type: "user",
    data: userMessage("m1", "start"),
  });
  const second = await store.append(path, {
    type: "assistant",
    parentId: first.id,
    data: assistantMessage("m2", "analysis"),
  });
  await store.append(path, {
    type: "assistant",
    parentId: first.id,
    data: assistantMessage("m3", "branch"),
  });
  const branch = await store.fork(path, second.id);
  const children = await store.children(path, second.id);
  expect(children.some((entry) => entry.id === branch)).toBeTrue();
  const linearized = await store.linearizeFrom(path, branch);
  expect(linearized).toHaveLength(3);
  expect(linearized.at(0)?.id).toBe(first.id);

  const session = await createAgentSession({
    sessionId: "integration-session",
    contextWindowTokens: 4096,
    reserveTokens: 128,
    autoCompaction: true,
  });

  const events: string[] = [];
  const unsubscribe = session.onEvent((event) => {
    events.push(event.type);
  });

  const steerPromise = session.steer({ message: userMessage("q1", "steer") });
  const followUpPromise = session.followUp({ message: userMessage("q2", "follow") });
  const steerTurn = await steerPromise;
  await followUpPromise;
  const state = await session.getState();

  unsubscribe();

  expect(events.at(0)).toBe("agent_start");
  expect(events.some((event) => event === "done")).toBeTrue();
  expect(steerTurn.finalState.sessionId).toBe("integration-session");
  expect(state.queueDepth.followUp).toBe(0);
  expect(state.queueDepth.steer).toBe(0);
  expect(linearized.some((entry) => entry.type === "assistant")).toBeTrue();
});
