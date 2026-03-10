import { createSessionIndex } from "../../packages/index/src/index.ts";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runBunScript(source: string): string {
  const result = Bun.spawnSync(["bun", "-e", source], {
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `script failed (${result.exitCode}): ${new TextDecoder().decode(result.stderr)}`,
    );
  }

  return new TextDecoder().decode(result.stdout).trim();
}

test("integration: sqlite index persists records across process restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-index-"));
  const dbPath = join(root, "sessions.sqlite");
  const encodedPath = JSON.stringify(dbPath);

  const writeOutput = runBunScript(`
    import { createSessionIndex } from "./packages/index/src/index.ts";

    const index = await createSessionIndex({ backend: "sqlite" });
    await index.init({ sessionDbPath: ${encodedPath} });
    await index.upsertSession("session-1", "entry-1", "alpha note");
    await index.upsertSession("session-1", "entry-2", "beta note");
    console.log(JSON.stringify(index.health()));
  `);

  const writeHealth = JSON.parse(writeOutput) as { backend: string };
  expect(writeHealth.backend).toBe("sqlite");

  const readOutput = runBunScript(`
    import { createSessionIndex } from "./packages/index/src/index.ts";

    const index = await createSessionIndex({ backend: "sqlite" });
    await index.init({ sessionDbPath: ${encodedPath} });
    const rows = await index.querySessions("alpha", 10);
    console.log(JSON.stringify(rows));
  `);

  expect(JSON.parse(readOutput)).toEqual([{ sessionId: "session-1", score: 1 }]);
});

test("integration: sqlite query scoring and idempotent upsert are correct", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-index-"));
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
});

test("integration: memory backend can be explicitly selected", async () => {
  const index = await createSessionIndex({ backend: "memory" });
  await index.init({ sessionDbPath: "ignored" });
  await index.upsertSession("session-m", "entry-1", "alpha memory");

  const rows = await index.querySessions("alpha", 10);
  expect(rows).toEqual([{ sessionId: "session-m", score: 1 }]);
  expect(index.health().backend).toBe("memory");
});
