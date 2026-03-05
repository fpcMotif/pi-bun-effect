import { expect, test } from "bun:test";
import { InMemoryAgentSession } from "../../packages/agent/src/agent-runtime";

test("cancelCurrentTurn emits abort event when running", async () => {
  const session = new InMemoryAgentSession({
    sessionId: "test-session",
    contextWindowTokens: 1000,
    reserveTokens: 100,
    autoCompaction: false,
  });

  const emitted: any[] = [];
  session.onEvent((e) => {
    emitted.push(e);
  });

  // Set the internal running state to true to simulate an active turn
  (session as any).running = true;
  await session.cancelCurrentTurn();

  const abortEvent = emitted.find(e => e.type === "abort");
  expect(abortEvent).toBeDefined();
  expect(abortEvent.sessionId).toBe("test-session");
  expect((session as any).running).toBe(false);
});

test("cancelCurrentTurn does not emit abort event when not running", async () => {
  const session = new InMemoryAgentSession({
    sessionId: "test-session",
    contextWindowTokens: 1000,
    reserveTokens: 100,
    autoCompaction: false,
  });

  const emitted: any[] = [];
  session.onEvent((e) => {
    emitted.push(e);
  });

  // running is false by default
  await session.cancelCurrentTurn();

  const abortEvent = emitted.find(e => e.type === "abort");
  expect(abortEvent).toBeUndefined();
  expect((session as any).running).toBe(false);
});
