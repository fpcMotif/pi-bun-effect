import { createSlackBot } from "../../packages/slack-bot/src/index";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("integration: slack channel state and logs stay isolated", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-slack-"));
  const bot = createSlackBot();
  await bot.start({
    token: "xoxb-test",
    socketMode: true,
    storageDir: root,
  });

  const channelA1 = await bot.routeEvent({
    channel: "C-A",
    user: "U1",
    text: "hello a",
    attachments: [{ id: "att-1", filename: "a.txt" }],
  });
  const channelB1 = await bot.routeEvent({
    channel: "C-B",
    user: "U2",
    text: "hello b",
    attachments: [{ id: "att-2", filename: "b.txt" }],
  });
  const channelA2 = await bot.routeEvent({
    channel: "C-A",
    user: "U1",
    text: "hello again a",
  });

  expect(channelA1.sessionId).not.toBe(channelB1.sessionId);
  expect(channelA2.sessionId).toBe(channelA1.sessionId);
  expect(channelA2.messageCount).toBe(2);
  expect(channelB1.messageCount).toBe(1);
  expect(bot.listChannels().sort()).toEqual(["C-A", "C-B"]);

  await bot.stop();

  const restarted = createSlackBot();
  await restarted.start({ token: "xoxb-test", socketMode: true, storageDir: root });
  const channelA3 = await restarted.routeEvent({ channel: "C-A", user: "U3", text: "after restart" });
  expect(channelA3.sessionId).toBe(channelA1.sessionId);
  expect(channelA3.messageCount).toBe(3);
});
