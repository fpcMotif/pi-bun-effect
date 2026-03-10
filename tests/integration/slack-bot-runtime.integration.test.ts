import { createSlackBot } from "../../packages/slack-bot/src/index";
import { expect, test } from "bun:test";

test("integration: slack adapter maps channels to sessions and enforces tool policy", async () => {
  const bot = createSlackBot({
    defaultAllowedTools: ["search", "read"],
    channelAllowedTools: {
      C123: ["search"],
    },
    deniedTools: ["shell"],
  });

  await bot.start({ token: "xoxb-test", socketMode: true });

  const handshake = bot.ingestEvent({
    type: "url_verification",
    challenge: "abc123",
  });

  const eventState = bot.ingestEvent({
    type: "event_callback",
    event: {
      type: "message",
      channel: "C123",
      user: "U1",
      text: "summarize this thread",
      thread_ts: "1.2",
    },
  });

  expect(handshake).toEqual({ challenge: "abc123" });
  expect(eventState && "sessionId" in eventState && eventState.sessionId).toBe("slack-C123");
  expect(bot.isToolAllowed("C123", "search")).toBeTrue();
  expect(bot.isToolAllowed("C123", "read")).toBeFalse();
  expect(bot.isToolAllowed("C123", "shell")).toBeFalse();
  expect(bot.isToolAllowed("C999", "read")).toBeTrue();

  await bot.stop();
});
