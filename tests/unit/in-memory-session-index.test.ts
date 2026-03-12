import { createSessionIndex, InMemorySessionIndex } from "@pi-bun-effect/index";
import { beforeEach, describe, expect, test } from "bun:test";

describe("InMemorySessionIndex", () => {
  let index: InMemorySessionIndex;

  beforeEach(() => {
    index = new InMemorySessionIndex();
  });

  test("upsertSession before init throws an error", async () => {
    expect(index.upsertSession("session1", "entry1", "Hello")).rejects.toThrow(
      "index not initialized",
    );
  });

  test("querySessions before init returns an empty array", async () => {
    expect(await index.querySessions("query")).toEqual([]);
  });

  test("init sets up the index correctly", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    expect(index.upsertSession("s", "e", "t")).resolves.toBeUndefined();
    expect(index.dbPath).toBe("/fake/path");
  });

  test("upsertSession adds a session and normalizes text to lowercase", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    await index.upsertSession("session1", "entry1", "HELLO WORLD");

    const results = await index.querySessions("hello");
    expect(results).toHaveLength(1);
    expect(results[0]?.sessionId).toBe("session1");
    expect(results[0]?.score).toBe(1);
  });

  test("upsertSession replaces an existing row with the same keys", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    await index.upsertSession("session1", "entry1", "first version");
    await index.upsertSession("session1", "entry1", "second version");
    await index.upsertSession("session1", "entry2", "another entry");

    expect(await index.querySessions("first")).toHaveLength(0);
    expect(await index.querySessions("second")).toHaveLength(1);
    expect(await index.querySessions("another")).toHaveLength(1);
  });

  test("querySessions matches case-insensitively", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    await index.upsertSession("session1", "entry1", "Some mixed CASE Text");

    expect(await index.querySessions("CASE")).toHaveLength(1);
    expect(await index.querySessions("mixed")).toHaveLength(1);
    expect(await index.querySessions("notfound")).toHaveLength(0);
  });

  test("querySessions respects the result limit", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    for (let i = 0; i < 25; i++) {
      await index.upsertSession(`session${i}`, "entry1", "common text");
    }

    expect(await index.querySessions("common")).toHaveLength(20);
    expect(await index.querySessions("common", 5)).toHaveLength(5);
  });

  test("createSessionIndex with memory backend returns InMemorySessionIndex", async () => {
    const idx = await createSessionIndex({ backend: "memory" });
    expect(idx).toBeInstanceOf(InMemorySessionIndex);
  });

  test("health reports memory backend status", async () => {
    const health = index.health();
    expect(health.backend).toBe("memory");
    expect(health.ready).toBe(false);

    await index.init({ sessionDbPath: "/fake/path" });
    expect(index.health().ready).toBe(true);
  });
});
