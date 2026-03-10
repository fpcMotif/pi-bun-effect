import {
  computeFrecency,
  createSearchService,
  normalizeToken,
  rankPath,
  type SearchService,
} from "@pi-bun-effect/search";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("frecency decay is monotonic for positive aging", () => {
  const near = computeFrecency(1, 1, 0.95);
  const far = computeFrecency(8, 1, 0.95);

  expect(near).toBeGreaterThan(far);
});

test("rank path includes frecency and git signals", () => {
  const stale = rankPath(
    "src/components/agent.ts",
    "agent",
    { fuzzy: 2, frecency: 1, git: 1 },
    0.1,
    false,
  );
  const freshAndDirty = rankPath(
    "src/components/agent.ts",
    "agent",
    { fuzzy: 2, frecency: 1, git: 1 },
    0.9,
    true,
  );

  expect(freshAndDirty).toBeGreaterThan(stale);
});

test("service rank reflects frecency from indexed files", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-search-rank-"));
  const file = join(root, "agent.log");
  mkdirSync(root, { recursive: true });
  writeFileSync(file, "agent");

  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
  utimesSync(file, oldDate, oldDate);

  const service: SearchService = createSearchService();
  await service.buildIndex(root);

  const staleScore = service.rank("agent", { fuzzy: 1, frecency: 3, git: 0 });

  const now = new Date();
  utimesSync(file, now, now);
  await service.buildIndex(root);

  const freshScore = service.rank("agent", { fuzzy: 1, frecency: 3, git: 0 });
  expect(freshScore).toBeGreaterThan(staleScore);
});

test("search content finds content-only hits", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-search-content-"));
  const src = join(root, "workspace");
  mkdirSync(src, { recursive: true });

  writeFileSync(join(src, "alpha.txt"), "completely unrelated heading");
  writeFileSync(join(src, "notes.md"), "contains hidden-nebula keyword here");

  const service: SearchService = createSearchService();
  await service.buildIndex(root);

  const byPath = await service.queryFiles("hidden-nebula", 10);
  const byContent = await service.queryContent("hidden-nebula", 10);

  expect(byPath.length).toBe(0);
  expect(byContent.some((entry) => entry.path.endsWith("notes.md"))).toBeTrue();
  expect(byContent[0]?.snippet?.toLowerCase()).toContain("hidden-nebula");
  expect(normalizeToken("  HeLLo  ")).toBe("hello");
});
