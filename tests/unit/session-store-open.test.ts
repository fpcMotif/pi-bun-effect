import { createSessionStore } from "@pi-bun-effect/session";
import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function getTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "session-store-test-"));
}

test("JsonlSessionStore.open creates directory and initializes file if not exists", async () => {
  const root = getTmpDir();
  const sessionPath = join(root, "subdir", "session.jsonl");
  const store = createSessionStore();

  await store.open(sessionPath);

  expect(existsSync(sessionPath)).toBeTrue();
  const content = readFileSync(sessionPath, "utf8");
  const header = JSON.parse(content.split("\n")[0]!);
  expect(header.version).toBe(3);
  expect(header.id).toBeDefined();
  expect(header.createdAt).toBeDefined();
  expect(header.updatedAt).toBeDefined();

  rmSync(root, { recursive: true, force: true });
});

test("JsonlSessionStore.open does not overwrite existing file", async () => {
  const root = getTmpDir();
  const sessionPath = join(root, "session.jsonl");
  const store = createSessionStore();

  const initialContent = "initial content";
  const { writeFileSync } = await import("node:fs");
  writeFileSync(sessionPath, initialContent);

  await store.open(sessionPath);

  const content = readFileSync(sessionPath, "utf8");
  expect(content).toBe(initialContent);

  rmSync(root, { recursive: true, force: true });
});
