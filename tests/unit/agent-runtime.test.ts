import { InMemoryAgentSession } from "@pi-bun-effect/agent";
import type { AgentMessage } from "@pi-bun-effect/core";
import { expect, test } from "bun:test";

function userMessage(id: string): AgentMessage {
  return {
    type: "user",
    role: "user",
    id,
    timestamp: new Date().toISOString(),
    content: [{ type: "text", text: id }],
  };
}

test("cancelCurrentTurn emits abort event through the public prompt flow", async () => {
  const session = new InMemoryAgentSession({
    sessionId: "test-session",
    contextWindowTokens: 1000,
    reserveTokens: 100,
    autoCompaction: false,
  });

  const emitted: Array<{ type?: string; sessionId?: string }> = [];
  session.onEvent((event) => {
    emitted.push(event);
  });

  const turn = session.prompt({ message: userMessage("msg-1") });
  await Promise.resolve();

  const running = await session.getState();
  expect(running.isRunning).toBeTrue();

  await session.cancelCurrentTurn();
  const result = await turn;

  const abortEvent = emitted.find((event) => event.type === "abort");
  expect(abortEvent).toBeDefined();
  expect(abortEvent?.sessionId).toBe("test-session");
  expect(emitted.some((event) => event.type === "done")).toBeFalse();
  expect(result.finalState.isRunning).toBeFalse();
  expect((await session.getState()).isRunning).toBeFalse();
});

test("cancelCurrentTurn does not emit abort when not running", async () => {
  const session = new InMemoryAgentSession({
    sessionId: "test-session",
    contextWindowTokens: 1000,
    reserveTokens: 100,
    autoCompaction: false,
  });

  const emitted: Array<{ type?: string }> = [];
  session.onEvent((event) => {
    emitted.push(event);
  });

  await session.cancelCurrentTurn();

  const abortEvent = emitted.find((event) => event.type === "abort");
  expect(abortEvent).toBeUndefined();
  expect((await session.getState()).isRunning).toBeFalse();
});
