import { createSessionStore } from "@pi-bun-effect/session";
import { expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "session-store-test-"));
}

test("JsonlSessionStore.open creates the directory and initializes a v3 file", async () => {
  const root = makeTmpDir();
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

test("JsonlSessionStore.open does not overwrite existing files", async () => {
  const root = makeTmpDir();
  const sessionPath = join(root, "session.jsonl");
  const store = createSessionStore();

  writeFileSync(sessionPath, "initial content");
  await store.open(sessionPath);

  expect(readFileSync(sessionPath, "utf8")).toBe("initial content");

  rmSync(root, { recursive: true, force: true });
});
