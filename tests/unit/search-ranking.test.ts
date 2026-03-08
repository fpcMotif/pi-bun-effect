import {
  computeFrecency,
  createSearchService,
  normalizeToken,
  rankPath,
  type SearchService,
} from "@pi-bun-effect/search";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("frecency decay is monotonic for positive aging", () => {
  const near = computeFrecency(1, 1, 0.95);
  const far = computeFrecency(8, 1, 0.95);

  expect(near).toBeGreaterThan(far);
});

test("rank path is deterministic and stable", () => {
  const scoreA = rankPath(
    "src/components/agent.ts",
    "agent",
    { fuzzy: 2, frecency: 1, git: 1 },
    0.5,
    false,
  );
  const scoreB = rankPath(
    "docs/agent.md",
    "agent",
    { fuzzy: 2, frecency: 1, git: 1 },
    0.5,
    false,
  );
  const scoreC = rankPath(
    "build/agent.md",
    "agent",
    { fuzzy: 2, frecency: 1, git: 1 },
    0.5,
    false,
  );

  expect(scoreA).toBe(scoreB);
  expect(scoreA).toBe(scoreC);
});

test("queryFiles prefers stronger path matches", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-search-"));
  const src = join(root, "workspace", "src");
  const docs = join(root, "workspace", "docs");

  mkdirSync(src, { recursive: true });
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(src, "agent.ts"), "agent runtime");
  writeFileSync(join(docs, "notes-about-agent.txt"), "agent notes");

  const service: SearchService = createSearchService();
  await service.buildIndex(root);

  const byPath = await service.queryFiles("agent", 10);

  expect(byPath.map((entry) => entry.path)).toHaveLength(2);
  expect(byPath[0]?.path).toContain("agent.ts");
  expect(byPath[0]?.score).toBeGreaterThan(byPath[1]?.score ?? 0);
  rmSync(root, { recursive: true, force: true });
});

test("queryContent searches indexed file contents, not just file paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-search-content-"));
  const workspace = join(root, "workspace");

  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "notes.txt"), "session replay transcript");
  writeFileSync(join(workspace, "other.txt"), "no relevant content");

  const service: SearchService = createSearchService();
  await service.buildIndex(root);

  const byContent = await service.queryContent("replay", 10);

  expect(Array.isArray(byContent)).toBeTrue();
  expect(byContent).toHaveLength(1);
  expect(byContent[0]?.path).toContain("notes.txt");
  expect(byContent[0]?.snippet).toContain("replay");
  rmSync(root, { recursive: true, force: true });
});

test("rank reflects the best indexed candidate", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-search-rank-"));
  const workspace = join(root, "workspace");

  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "agent.ts"), "agent");
  writeFileSync(join(workspace, "notes.txt"), "misc");

  const service = createSearchService();
  await service.buildIndex(root);

  const agentRank = service.rank("agent", { fuzzy: 2, frecency: 1, git: 0 });
  const missingRank = service.rank("missing", {
    fuzzy: 2,
    frecency: 1,
    git: 0,
  });

  expect(agentRank).toBeGreaterThan(0);
  expect(agentRank).toBeGreaterThan(missingRank);
  rmSync(root, { recursive: true, force: true });
});

test("normalizeToken trims and lowercases input", () => {
  expect(normalizeToken("  HeLLo  ")).toBe("hello");
});

test("rank returns 0 for empty index", () => {
  const service = createSearchService();
  const rank = service.rank("test", { fuzzy: 1, frecency: 1, git: 1 });
  expect(rank).toBe(0);
});
