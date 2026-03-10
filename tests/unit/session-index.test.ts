import { createSessionIndex, type SearchIndex } from "../../packages/index/src/index";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("sqlite session index persists rows across index restarts", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-index-"));
  const dbPath = join(root, "search", "session-index.sqlite");

  const first: SearchIndex = createSessionIndex({ backend: "sqlite" });
  await first.init({ sessionDbPath: dbPath });
  await first.upsertSession("session-a", "entry-1", "hello world");
  await first.upsertSession("session-a", "entry-2", "hello bun");
  await first.upsertSession("session-b", "entry-1", "hello world");

  const second: SearchIndex = createSessionIndex({ backend: "sqlite" });
  await second.init({ sessionDbPath: dbPath });

  const rows = await second.querySessions("hello", 10);
  expect(rows).toEqual([
    { sessionId: "session-a", score: 2 },
    { sessionId: "session-b", score: 1 },
  ]);
});

test("sqlite upsert is keyed by sessionId and entryId", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-index-"));
  const dbPath = join(root, "index.sqlite");

  const index = createSessionIndex({ backend: "sqlite" });
  await index.init({ sessionDbPath: dbPath });

  await index.upsertSession("session-a", "entry-1", "apple");
  await index.upsertSession("session-a", "entry-1", "banana");
  await index.upsertSession("session-a", "entry-2", "banana");

  const rows = await index.querySessions("banana", 10);
  expect(rows).toEqual([{ sessionId: "session-a", score: 2 }]);
});

test("indexing JSONL session write path entries remains compatible", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-session-"));
  const sessionPath = join(root, "sessions", "chat.jsonl");
  const sessionId = "chat";

  mkdirSync(join(root, "sessions"), { recursive: true });

  writeFileSync(
    sessionPath,
    [
      JSON.stringify({
        version: 3,
        id: sessionId,
        createdAt: new Date().toISOString(),
      }),
      JSON.stringify({
        id: "entry-1",
        type: "user",
        timestamp: new Date().toISOString(),
        data: {
          id: "message-1",
          role: "user",
          type: "user",
          timestamp: new Date().toISOString(),
          content: [{ type: "text", text: "compile plan" }],
        },
      }),
      JSON.stringify({
        id: "entry-2",
        type: "assistant",
        timestamp: new Date().toISOString(),
        data: {
          id: "message-2",
          role: "assistant",
          type: "assistant",
          timestamp: new Date().toISOString(),
          content: [{ type: "text", text: "execution result" }],
        },
      }),
    ].join("\n"),
  );

  const index = createSessionIndex({ backend: "sqlite" });
  await index.init({ sessionDbPath: join(root, "search.sqlite") });

  const lines = Bun.file(sessionPath)
    .text()
    .then((text) => text.split(/\r?\n/).slice(1).filter(Boolean));
  for (const line of await lines) {
    const entry = JSON.parse(line) as {
      id: string;
      data: { content: Array<{ text?: string }> };
    };
    const text = entry.data.content.map((block) => block.text ?? "").join(" ");
    await index.upsertSession(sessionId, entry.id, text);
  }

  expect(await index.querySessions("compile", 10)).toEqual([
    { sessionId: "chat", score: 1 },
  ]);
  expect(await index.querySessions("execution", 10)).toEqual([
    { sessionId: "chat", score: 1 },
  ]);
});

test("factory can create in-memory fallback implementation", async () => {
  const index = createSessionIndex({ backend: "memory" });
  await index.init({ sessionDbPath: ":memory:" });
  await index.upsertSession("session", "entry-1", "alpha beta");
  await index.upsertSession("session", "entry-2", "alpha gamma");

  expect(await index.querySessions("alpha", 10)).toEqual([
    { sessionId: "session", score: 2 },
  ]);
});
