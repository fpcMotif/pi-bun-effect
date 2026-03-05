import { expect, test, describe, beforeEach } from "bun:test";
import { createSlackBot, InMemorySlackBot, type SlackConfig, type SlackEvent } from "@pi-bun-effect/slack-bot";

describe("InMemorySlackBot", () => {
  let bot: InMemorySlackBot;

  beforeEach(() => {
    bot = createSlackBot();
  });

  test("createSlackBot returns an instance of InMemorySlackBot", () => {
    expect(bot).toBeInstanceOf(InMemorySlackBot);
  });

  test("start sets running to true", async () => {
    const config: SlackConfig = {
      token: "test-token",
      socketMode: true,
    };

    await bot.start(config);
    // @ts-expect-error accessing private property for testing
    expect(bot.running).toBeTrue();
  });

  test("stop sets running to false", async () => {
    // Start it first to verify it changes from true to false
    await bot.start({ token: "test", socketMode: true });
    // @ts-expect-error accessing private property for testing
    expect(bot.running).toBeTrue();

    await bot.stop();
    // @ts-expect-error accessing private property for testing
    expect(bot.running).toBeFalse();
  });

  describe("routeEvent", () => {
    test("creates new channel state on first event", () => {
      const event: SlackEvent = {
        channel: "C12345",
        user: "U123",
        text: "hello world",
      };

      const state = bot.routeEvent(event);

      expect(state).toEqual({
        channelId: "C12345",
        messageCount: 1,
        lastPrompt: "hello world",
      });
    });

    test("updates existing channel state on subsequent events", () => {
      const event1: SlackEvent = {
        channel: "C12345",
        user: "U123",
        text: "first message",
      };

      const event2: SlackEvent = {
        channel: "C12345",
        user: "U123",
        text: "second message",
      };

      bot.routeEvent(event1);
      const state = bot.routeEvent(event2);

      expect(state).toEqual({
        channelId: "C12345",
        messageCount: 2,
        lastPrompt: "second message",
      });
    });

    test("handles multiple channels independently", () => {
      const event1: SlackEvent = {
        channel: "C1",
        user: "U1",
        text: "msg 1",
      };

      const event2: SlackEvent = {
        channel: "C2",
        user: "U2",
        text: "msg 2",
      };

      const state1 = bot.routeEvent(event1);
      const state2 = bot.routeEvent(event2);

      expect(state1.channelId).toBe("C1");
      expect(state1.messageCount).toBe(1);

      expect(state2.channelId).toBe("C2");
      expect(state2.messageCount).toBe(1);
    });
  });

  describe("listChannels", () => {
    test("returns empty array initially", () => {
      expect(bot.listChannels()).toEqual([]);
    });

    test("returns array of channel IDs after events", () => {
      bot.routeEvent({ channel: "C1", user: "U1", text: "msg" });
      bot.routeEvent({ channel: "C2", user: "U2", text: "msg" });

      // Send another message to C1 to ensure it's still just one entry
      bot.routeEvent({ channel: "C1", user: "U3", text: "msg2" });

      const channels = bot.listChannels();

      expect(channels).toHaveLength(2);
      expect(channels).toContain("C1");
      expect(channels).toContain("C2");
    });
  });
});
