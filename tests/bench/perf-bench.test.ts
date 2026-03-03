import { createSearchService } from "@pi-bun-effect/search";
import { createSessionStore } from "@pi-bun-effect/session";
import { createToolRegistry, registerBuiltinTools } from "@pi-bun-effect/tools";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("bench: startup path and registry hydration cost", () => {
  const start = performance.now();
  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const loaded = registry.list();
  const cost = performance.now() - start;

  expect(loaded.length).toBe(4);
  expect(cost).toBeGreaterThan(0);
  console.log(`[bench] tool-registry-init-ms=${cost.toFixed(2)}`);
});

test("bench: session append and search throughput baseline", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-bench-"));
  const sessionPath = join(root, "session.jsonl");
  const searchRoot = join(root, "search");
  mkdirSync(searchRoot, { recursive: true });
  writeFileSync(join(searchRoot, "hit-a.txt"), "alpha");
  writeFileSync(join(searchRoot, "hit-b.txt"), "beta");

  const store = createSessionStore();
  const start = performance.now();
  for (let i = 0; i < 1200; i += 1) {
    await store.append(sessionPath, {
      type: "assistant",
      data: {
        type: "assistant",
        role: "assistant",
        id: `bench-${i}`,
        timestamp: new Date().toISOString(),
        model: "bench-model",
        content: [{ type: "text", text: `entry-${i}` }],
      },
    });
  }
  const appendDuration = performance.now() - start;

  const entries = await store.readAll(sessionPath);
  const service = createSearchService();
  const searchStart = performance.now();
  await service.buildIndex(searchRoot);
  const hits = await service.queryFiles("hit");
  const searchDuration = performance.now() - searchStart;

  expect(entries).toHaveLength(1200);
  expect(hits.length).toBeGreaterThanOrEqual(2);

  expect(appendDuration).toBeGreaterThanOrEqual(0);
  expect(searchDuration).toBeGreaterThanOrEqual(0);
  expect(appendDuration + searchDuration).toBeLessThan(15000);

  console.log(`[bench] session-append-1200-ms=${appendDuration.toFixed(2)}`);
  console.log(`[bench] search-query-ms=${searchDuration.toFixed(2)}`);

  rmSync(root, { recursive: true, force: true });
});
