import { InMemorySessionIndex, createSessionIndex } from "../../packages/index/src/index.ts";
import { expect, test, describe, beforeEach } from "bun:test";

describe("InMemorySessionIndex", () => {
  let index: InMemorySessionIndex;

  beforeEach(() => {
    index = new InMemorySessionIndex();
  });

  test("upsertSession before init throws an error", async () => {
    expect(index.upsertSession("session1", "entry1", "Hello")).rejects.toThrow("index not initialized");
  });

  test("querySessions before init returns an empty array", async () => {
    const results = await index.querySessions("query");
    expect(results).toEqual([]);
  });

  test("init sets up the index correctly", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    // Verify behavior changed by init: upserting should no longer throw
    expect(index.upsertSession("s", "e", "t")).resolves.toBeUndefined();
    // Verify dbPath getter
    expect(index.dbPath).toBe("/fake/path");
  });

  test("upsertSession adds a session and normalizes text to lowercase", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    await index.upsertSession("session1", "entry1", "HELLO WORLD");

    // Test the text normalization by querying with lowercase
    const results = await index.querySessions("hello");
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe("session1");
    expect(results[0].score).toBe(1);
  });

  test("upsertSession replaces an existing session with the same sessionId and entryId", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    await index.upsertSession("session1", "entry1", "first version");
    await index.upsertSession("session1", "entry1", "second version");
    await index.upsertSession("session1", "entry2", "another entry");

    const results1 = await index.querySessions("first");
    expect(results1).toHaveLength(0); // first version should be gone

    const results2 = await index.querySessions("second");
    expect(results2).toHaveLength(1);
    expect(results2[0].sessionId).toBe("session1");

    const results3 = await index.querySessions("another");
    expect(results3).toHaveLength(1);
  });

  test("querySessions finds matching sessions case-insensitively", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    await index.upsertSession("session1", "entry1", "Some mixed CASE Text");

    const results1 = await index.querySessions("CASE");
    expect(results1).toHaveLength(1);

    const results2 = await index.querySessions("mixed");
    expect(results2).toHaveLength(1);

    const results3 = await index.querySessions("notfound");
    expect(results3).toHaveLength(0);
  });

  test("querySessions limits the number of returned results", async () => {
    await index.init({ sessionDbPath: "/fake/path" });
    for (let i = 0; i < 25; i++) {
      await index.upsertSession(`session${i}`, "entry1", "common text");
    }

    // Default limit is 20
    const results1 = await index.querySessions("common");
    expect(results1).toHaveLength(20);

    // Custom limit
    const results2 = await index.querySessions("common", 5);
    expect(results2).toHaveLength(5);
  });

  test("createSessionIndex returns a valid SearchIndex", () => {
    const searchIndex = createSessionIndex();
    expect(searchIndex).toBeInstanceOf(InMemorySessionIndex);
  });
});
