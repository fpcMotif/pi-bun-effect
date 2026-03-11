import { beforeEach, describe, expect, test } from "bun:test";
import {
  createSlackBot,
  InMemorySlackBot,
  type SlackConfig,
  type SlackEvent,
} from "./index.ts";

describe("InMemorySlackBot", () => {
  let bot: InMemorySlackBot;
  const mockConfig: SlackConfig = {
    token: "test-token",
    socketMode: true,
  };

  beforeEach(() => {
    bot = createSlackBot();
  });

  test("should start and stop correctly", async () => {
    // Initial state: not running
    expect(() => bot.routeEvent({ channel: "C1", user: "U1", text: "hello" }))
      .toThrow(
        "Bot is not running; call start() first",
      );

    await bot.start(mockConfig);
    // Should now be running and accept events
    const state = bot.routeEvent({ channel: "C1", user: "U1", text: "hello" });
    expect(state.messageCount).toBe(1);

    await bot.stop();
    // Should be stopped again
    expect(() => bot.routeEvent({ channel: "C1", user: "U1", text: "hello" }))
      .toThrow(
        "Bot is not running; call start() first",
      );
  });

  test("should correctly route events for a new channel", async () => {
    await bot.start(mockConfig);

    const event: SlackEvent = {
      channel: "C_NEW",
      user: "U1",
      text: "first message",
    };
    const state = bot.routeEvent(event);

    expect(state).toEqual({
      channelId: "C_NEW",
      messageCount: 1,
      lastPrompt: "first message",
    });
  });

  test("should correctly route events and increment counts for an existing channel", async () => {
    await bot.start(mockConfig);

    const event1: SlackEvent = {
      channel: "C_EXISTING",
      user: "U1",
      text: "first message",
    };
    bot.routeEvent(event1);

    const event2: SlackEvent = {
      channel: "C_EXISTING",
      user: "U2",
      text: "second message",
    };
    const state = bot.routeEvent(event2);

    expect(state).toEqual({
      channelId: "C_EXISTING",
      messageCount: 2,
      lastPrompt: "second message",
    });
  });

  test("should list channels correctly", async () => {
    await bot.start(mockConfig);

    expect(bot.listChannels()).toEqual([]);

    bot.routeEvent({ channel: "C1", user: "U1", text: "hello C1" });
    bot.routeEvent({ channel: "C2", user: "U1", text: "hello C2" });
    bot.routeEvent({ channel: "C1", user: "U2", text: "hello again C1" }); // same channel

    const channels = bot.listChannels();
    expect(channels).toHaveLength(2);
    expect(channels).toContain("C1");
    expect(channels).toContain("C2");
  });
});
