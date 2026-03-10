import { createAgentSession } from "@pi-bun-effect/agent";
import type { AgentMessage } from "@pi-bun-effect/core";
import { createMockLlmProvider } from "@pi-bun-effect/llm";
import type { LlmModelId } from "@pi-bun-effect/llm";
import { createSessionStore } from "@pi-bun-effect/session";
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

  await session.requestQueue({
    queue: "followUp",
    content: "pre-queued turn",
  });
  const steerTurn = await session.steer({
    message: userMessage("q1", "steer"),
  });
  await session.prompt({ message: userMessage("q2", "ask again") });
  const state = await session.getState();

  unsubscribe();

  expect(events.at(0)).toBe("agent_start");
  expect(events.some((event) => event === "done")).toBeTrue();
  expect(steerTurn.finalState.sessionId).toBe("integration-session");
  expect(state.queueDepth.followUp).toBe(0);
  expect(state.queueDepth.steer).toBe(0);
  expect(linearized.some((entry) => entry.type === "assistant")).toBeTrue();
});


test("integration: replay chain remains valid after compaction summaries", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-integration-"));
  const path = join(root, "session-replay.jsonl");
  const store = createSessionStore();

  const rootEntry = await store.append(path, {
    id: "root",
    type: "user",
    data: userMessage("u1", "initial prompt"),
  });
  const assistantEntry = await store.append(path, {
    id: "assistant-1",
    type: "assistant",
    parentId: rootEntry.id,
    data: assistantMessage("a1", "long answer"),
  });
  const compactionEntry = await store.appendCompactionSummary(path, {
    id: "compact-1",
    parentId: assistantEntry.id,
    text: "Compacted earlier turns.",
  });
  const branchEntry = await store.appendBranchSummary(path, {
    id: "branch-1",
    parentId: compactionEntry.id,
    text: "Branched after replay.",
  });
  const resumed = await store.append(path, {
    id: "assistant-2",
    type: "assistant",
    parentId: branchEntry.id,
    data: assistantMessage("a2", "resumed context"),
  });

  const chain = await store.linearizeFrom(path, resumed.id);

  expect(chain.map((entry) => entry.id)).toEqual([
    "root",
    "assistant-1",
    "compact-1",
    "branch-1",
    "assistant-2",
  ]);
  expect(chain.map((entry) => entry.type)).toEqual([
    "user",
    "assistant",
    "compactionSummary",
    "branchSummary",
    "assistant",
  ]);
});
