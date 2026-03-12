import { createSessionIndex, SqliteSessionIndex } from "@pi-bun-effect/index";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("integration: sqlite index persists records across init cycles", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-index-"));
  const dbPath = join(root, "sessions.sqlite");

  const first = await createSessionIndex({ backend: "sqlite" });
  expect(first).toBeInstanceOf(SqliteSessionIndex);
  await first.init({ sessionDbPath: dbPath });
  await first.upsertSession("session-1", "entry-1", "alpha note");
  await first.upsertSession("session-1", "entry-2", "beta note");
  expect(first.health().backend).toBe("sqlite");
  (first as SqliteSessionIndex).close();

  const second = await createSessionIndex({ backend: "sqlite" });
  await second.init({ sessionDbPath: dbPath });
  const rows = await second.querySessions("alpha", 10);
  expect(rows).toEqual([{ sessionId: "session-1", score: 1 }]);
  (second as SqliteSessionIndex).close();
});

test("integration: sqlite upsert is idempotent and scoring aggregates by session", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-index-"));
  const dbPath = join(root, "sessions.sqlite");

  const index = await createSessionIndex({ backend: "sqlite" });
  await index.init({ sessionDbPath: dbPath });

  await index.upsertSession("session-a", "entry-1", "alpha old");
  await index.upsertSession("session-a", "entry-1", "no match");
  await index.upsertSession("session-a", "entry-2", "alpha current");
  await index.upsertSession("session-a", "entry-3", "alpha another");
  await index.upsertSession("session-b", "entry-1", "alpha single");

  const rows = await index.querySessions("alpha", 10);
  expect(rows).toEqual([
    { sessionId: "session-a", score: 2 },
    { sessionId: "session-b", score: 1 },
  ]);

  expect(index.health()).toEqual({
    backend: "sqlite",
    ready: true,
    persistent: true,
    details: dbPath,
  });
  (index as SqliteSessionIndex).close();
});

test("integration: memory backend can be explicitly selected", async () => {
  const index = await createSessionIndex({ backend: "memory" });
  await index.init({ sessionDbPath: "ignored" });
  await index.upsertSession("session-m", "entry-1", "alpha memory");

  const rows = await index.querySessions("alpha", 10);
  expect(rows).toEqual([{ sessionId: "session-m", score: 1 }]);
  expect(index.health().backend).toBe("memory");
});
