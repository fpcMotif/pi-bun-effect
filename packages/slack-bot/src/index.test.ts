import { describe, expect, test } from "bun:test";
import { createSlackBot, InMemorySlackBot } from "./index.ts";

describe("InMemorySlackBot", () => {
  test("createSlackBot factory creates an instance", () => {
    const bot = createSlackBot();
    expect(bot).toBeInstanceOf(InMemorySlackBot);
  });

  test("starts and stops correctly", async () => {
    const bot = createSlackBot();

    // @ts-expect-error - testing private property
    expect(bot.running).toBeFalse();

    await bot.start({ token: "test", socketMode: true });

    // @ts-expect-error - testing private property
    expect(bot.running).toBeTrue();

    await bot.stop();

    // @ts-expect-error - testing private property
    expect(bot.running).toBeFalse();
  });

  test("routeEvent throws if not running", () => {
    const bot = createSlackBot();
    expect(() => {
      bot.routeEvent({ channel: "C123", user: "U123", text: "hello" });
    }).toThrow("Bot is not running; call start() first");
  });

  test("routeEvent creates new channel state and updates existing", async () => {
    const bot = createSlackBot();
    await bot.start({ token: "test", socketMode: true });

    // New channel
    const state1 = bot.routeEvent({
      channel: "C123",
      user: "U123",
      text: "first message",
    });
    expect(state1).toEqual({
      channelId: "C123",
      messageCount: 1,
      lastPrompt: "first message",
    });

    // Existing channel update
    const state2 = bot.routeEvent({
      channel: "C123",
      user: "U456",
      text: "second message",
    });
    expect(state2).toEqual({
      channelId: "C123",
      messageCount: 2,
      lastPrompt: "second message",
    });

    // Different channel
    const state3 = bot.routeEvent({
      channel: "C999",
      user: "U123",
      text: "other channel",
    });
    expect(state3).toEqual({
      channelId: "C999",
      messageCount: 1,
      lastPrompt: "other channel",
    });
  });

  test("listChannels returns array of active channel IDs", async () => {
    const bot = createSlackBot();
    await bot.start({ token: "test", socketMode: true });

    expect(bot.listChannels()).toEqual([]);

    bot.routeEvent({ channel: "C1", user: "U1", text: "a" });
    bot.routeEvent({ channel: "C2", user: "U2", text: "b" });
    bot.routeEvent({ channel: "C1", user: "U3", text: "c" });

    expect(bot.listChannels()).toEqual(["C1", "C2"]);
  });
});
