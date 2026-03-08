import { InMemoryAgentSession } from "@pi-bun-effect/agent";
import { expect, test } from "bun:test";

test("cancelCurrentTurn emits abort event when running", async () => {
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

  (session as unknown as { running: boolean }).running = true;
  await session.cancelCurrentTurn();

  const abortEvent = emitted.find((event) => event.type === "abort");
  expect(abortEvent).toBeDefined();
  expect(abortEvent?.sessionId).toBe("test-session");
  expect((session as unknown as { running: boolean }).running).toBeFalse();
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
  expect((session as unknown as { running: boolean }).running).toBeFalse();
});
