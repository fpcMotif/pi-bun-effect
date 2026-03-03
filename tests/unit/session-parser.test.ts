import { rm } from "node:fs/promises";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { createSessionStore, type JsonlSessionEntry } from "@pi-bun-effect/session";
import type { AgentMessage } from "@pi-bun-effect/core";

function tmpSessionFile(): string {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-session-"));
  mkdirSync(root, { recursive: true });
  return join(root, "session.jsonl");
}

function userMessage(text: string): AgentMessage {
  return {
    type: "user",
    role: "user",
    id: `m-${text}`,
    timestamp: new Date().toISOString(),
    content: [{ type: "text", text }]
  };
}

function assistantMessage(text: string): AgentMessage {
  return {
    type: "assistant",
    role: "assistant",
    id: `a-${text}`,
    timestamp: new Date().toISOString(),
    model: "test-model",
    content: [{ type: "text", text }]
  };
}

test("session parser reads v3 header and message entries", async () => {
  const path = tmpSessionFile();
  const store = createSessionStore();
  const m1: JsonlSessionEntry = {
    id: "m1",
    type: "user",
    timestamp: new Date().toISOString(),
    data: userMessage("first")
  };
  const m2: JsonlSessionEntry = {
    id: "m2",
    type: "assistant",
    parentId: "m1",
    timestamp: new Date().toISOString(),
    data: assistantMessage("echo")
  };

  await store.append(path, m1);
  await store.append(path, m2);
  const header = await store.readHeader(path);
  const entries = await store.readAll(path);

  expect(header.version).toBe(3);
  expect(entries).toHaveLength(2);
  expect(entries[0]?.id).toBe("m1");
  expect(entries[1]?.parentId).toBe("m1");
});

test("session migration keeps entries and upgrades versions", async () => {
  const path = tmpSessionFile();
  const legacyHeader = JSON.stringify({
    version: 1,
    id: "legacy",
    createdAt: new Date("2020-01-01T00:00:00.000Z").toISOString()
  });
  const message: AgentMessage = userMessage("legacy hello");
  const legacyEntry = JSON.stringify({
    id: "legacy-entry",
    type: "user",
    timestamp: new Date().toISOString(),
    data: message
  });
  writeFileSync(path, `${legacyHeader}\n${legacyEntry}\n`);

  const migrated = await createSessionStore().migrate(path);
  const header = await createSessionStore().readHeader(path);
  const entries = await createSessionStore().readAll(path);

  expect(migrated).toBe(3);
  expect(header.version).toBe(3);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.id).toBe("legacy-entry");
});

test("invalid JSON lines fail with a parser error", async () => {
  const path = tmpSessionFile();
  writeFileSync(
    path,
    [
      JSON.stringify({ version: 3, id: "x", createdAt: new Date().toISOString() }),
      "{ invalid",
      JSON.stringify({ id: "m", type: "user", timestamp: new Date().toISOString(), data: userMessage("bad") })
    ].join("\n")
  );

  await expect(createSessionStore().readAll(path)).rejects.toThrow(/Malformed JSON/);
});

test("fork and tree traversal keep branch integrity", async () => {
  const path = tmpSessionFile();
  const store = createSessionStore();
  const root: JsonlSessionEntry = {
    id: "a",
    type: "assistant",
    timestamp: new Date().toISOString(),
    data: assistantMessage("A")
  };
  await store.append(path, root);
  const b: JsonlSessionEntry = {
    id: "b",
    type: "assistant",
    parentId: "a",
    timestamp: new Date().toISOString(),
    data: assistantMessage("B")
  };
  await store.append(path, b);
  const c: JsonlSessionEntry = {
    id: "c",
    type: "assistant",
    parentId: "b",
    timestamp: new Date().toISOString(),
    data: assistantMessage("C")
  };
  await store.append(path, c);

  const d = await store.fork(path, "b");
  const children = await store.children(path, "b");
  const lineage = await store.linearizeFrom(path, "c");

  expect(children.some((entry) => entry.id === "c")).toBeTrue();
  expect(children.some((entry) => entry.id === d)).toBeTrue();
  expect(lineage.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
});

test("parent lookup supports branch navigation", async () => {
  const path = tmpSessionFile();
  const store = createSessionStore();
  await store.append(path, {
    id: "root",
    type: "assistant",
    timestamp: new Date().toISOString(),
    data: assistantMessage("root")
  });
  const child = await store.fork(path, "root");
  const parent = await store.parent(path, child);

  expect(parent?.id).toBe("root");

  const selected = await store.switch(path, child);
  expect(selected?.id).toBe(child);

  rm(path, { force: true }).catch(() => undefined);
});
