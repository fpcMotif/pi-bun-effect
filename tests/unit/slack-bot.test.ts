import {
  createSlackBot,
  InMemorySlackBot,
  type SlackConfig,
  type SlackEvent,
} from "@pi-bun-effect/slack-bot";
import { beforeEach, describe, expect, test } from "bun:test";

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
    // @ts-expect-error testing private runtime state
    expect(bot.running).toBeTrue();
  });

  test("stop sets running to false", async () => {
    await bot.start({ token: "test", socketMode: true });
    // @ts-expect-error testing private runtime state
    expect(bot.running).toBeTrue();

    await bot.stop();
    // @ts-expect-error testing private runtime state
    expect(bot.running).toBeFalse();
  });

  test("routeEvent creates new channel state on first event", () => {
    const event: SlackEvent = {
      channel: "C12345",
      user: "U123",
      text: "hello world",
    };

    expect(bot.routeEvent(event)).toEqual({
      channelId: "C12345",
      messageCount: 1,
      lastPrompt: "hello world",
    });
  });

  test("routeEvent updates existing channel state", () => {
    bot.routeEvent({
      channel: "C12345",
      user: "U123",
      text: "first message",
    });

    expect(
      bot.routeEvent({
        channel: "C12345",
        user: "U123",
        text: "second message",
      }),
    ).toEqual({
      channelId: "C12345",
      messageCount: 2,
      lastPrompt: "second message",
    });
  });

  test("routeEvent handles multiple channels independently", () => {
    const state1 = bot.routeEvent({ channel: "C1", user: "U1", text: "msg 1" });
    const state2 = bot.routeEvent({ channel: "C2", user: "U2", text: "msg 2" });

    expect(state1.channelId).toBe("C1");
    expect(state1.messageCount).toBe(1);
    expect(state2.channelId).toBe("C2");
    expect(state2.messageCount).toBe(1);
  });

  test("listChannels returns an empty array initially", () => {
    expect(bot.listChannels()).toEqual([]);
  });

  test("listChannels returns unique channel ids after events", () => {
    bot.routeEvent({ channel: "C1", user: "U1", text: "msg" });
    bot.routeEvent({ channel: "C2", user: "U2", text: "msg" });
    bot.routeEvent({ channel: "C1", user: "U3", text: "msg2" });

    const channels = bot.listChannels();
    expect(channels).toHaveLength(2);
    expect(channels).toContain("C1");
    expect(channels).toContain("C2");
  });
});
