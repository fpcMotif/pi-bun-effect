import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "bun:test";
import { computeFrecency, createSearchService, normalizeToken, rankPath, type SearchService } from "@pi-bun-effect/search";

test("frecency decay is monotonic for positive aging", () => {
  const near = computeFrecency(1, 1, 0.95);
  const far = computeFrecency(8, 1, 0.95);

  expect(near).toBeGreaterThan(far);
});

test("rank path is deterministic and stable", () => {
  const scoreA = rankPath("src/components/agent.ts", "agent", { fuzzy: 2, frecency: 1, git: 1 }, 0.5, false);
  const scoreB = rankPath("docs/agent.md", "agent", { fuzzy: 2, frecency: 1, git: 1 }, 0.5, false);
  const scoreC = rankPath("README.md", "agent", { fuzzy: 2, frecency: 1, git: 1 }, 0.5, false);

  expect(scoreA).toBe(scoreB);
  expect(scoreA).toBe(scoreC);
});

test("search indexing and query returns matches", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-search-"));
  const src = join(root, "workspace");
  const nested = join(src, "notes");
  mkdirSync(src, { recursive: true });
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(src, "agent.txt"), "agent message");
  writeFileSync(join(nested, "agent.spec.ts"), "spec");

  const service: SearchService = createSearchService();
  await service.buildIndex(root);

  const byPath = await service.queryFiles("agent", 10);
  const byContent = await service.queryContent("agent", 10);

  expect(Array.isArray(byPath)).toBeTrue();
  expect(Array.isArray(byContent)).toBeTrue();
  expect(byPath.some((entry) => entry.path.includes("agent"))).toBeTrue();
  expect(normalizeToken("  HeLLo  ")).toBe("hello");
});
