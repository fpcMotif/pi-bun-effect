import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SearchMatch {
  path: string;
  score: number;
  snippet?: string;
}

export interface SearchService {
  buildIndex(root: string): Promise<void>;
  queryFiles(pattern: string, limit?: number): Promise<SearchMatch[]>;
  queryContent(query: string, limit?: number): Promise<SearchMatch[]>;
  rank(
    pattern: string,
    weights: { fuzzy: number; frecency: number; git: number },
  ): number;
}

export interface SearchWeights {
  fuzzy: number;
  frecency: number;
  git: number;
}

interface SearchDocument {
  path: string;
  content: string;
  indexedAt: number;
}

const DEFAULT_QUERY_WEIGHTS: SearchWeights = {
  fuzzy: 1,
  frecency: 0.25,
  git: 0,
};

export function normalizeToken(input: string): string {
  return input.trim().toLowerCase();
}

export function computeFrecency(
  ageInHours: number,
  base = 1,
  decay = 0.95,
): number {
  if (ageInHours <= 0) {
    return base;
  }
  return decay ** ageInHours * base;
}

function scoreFuzzyMatch(path: string, pattern: string): number {
  const normalizedPath = normalizeToken(path);
  const normalizedPattern = normalizeToken(pattern);

  if (!normalizedPattern) {
    return 0;
  }

  const baseName = normalizedPath.split(/[\\/]/).at(-1) ?? normalizedPath;
  if (baseName === normalizedPattern) {
    return 1;
  }

  if (baseName.startsWith(normalizedPattern)) {
    return 0.9;
  }

  if (baseName.includes(normalizedPattern)) {
    return 0.8;
  }

  const index = normalizedPath.indexOf(normalizedPattern);
  if (index === -1) {
    return 0;
  }

  const distance = index / Math.max(normalizedPath.length, 1);
  return Math.max(0.25, 0.7 - distance / 2);
}

function ageInHours(indexedAt: number): number {
  return Math.max(0, (Date.now() - indexedAt) / 3_600_000);
}

function compareMatches(a: SearchMatch, b: SearchMatch): number {
  return b.score - a.score || a.path.localeCompare(b.path);
}

function extractSnippet(
  content: string,
  start: number,
  length: number,
): string {
  const snippetStart = Math.max(0, start - 24);
  const snippetEnd = Math.min(content.length, start + length + 24);
  return content.slice(snippetStart, snippetEnd).trim();
}

export function rankPath(
  path: string,
  pattern: string,
  weights: SearchWeights,
  frecency = 1,
  isGitDirty = false,
): number {
  const fuzzyScore = scoreFuzzyMatch(path, pattern);
  if (fuzzyScore === 0) {
    return 0;
  }

  const gitBoost = isGitDirty ? 1 : 0;
  return (
    fuzzyScore * weights.fuzzy
    + frecency * weights.frecency
    + gitBoost * weights.git
  );
}

export class InMemorySearchService implements SearchService {
  private readonly index = new Map<string, SearchDocument>();

  private async collectFiles(root: string): Promise<string[]> {
    const resolved = resolve(root);
    const walk = async (directory: string, out: string[]): Promise<void> => {
      const items = await readdir(directory, { withFileTypes: true });
      for (const item of items) {
        if (item.name === ".git" || item.name === "node_modules") {
          continue;
        }
        const full = resolve(directory, item.name);
        if (item.isDirectory()) {
          await walk(full, out);
        } else {
          out.push(full);
        }
      }
    };

    const files: string[] = [];
    await walk(resolved, files);
    return files;
  }

  async buildIndex(root: string): Promise<void> {
    this.index.clear();
    const files = await this.collectFiles(root);
    for (const fullPath of files) {
      const content = await readFile(fullPath, "utf8").catch(() => "");
      this.index.set(fullPath, {
        path: fullPath,
        content,
        indexedAt: Date.now(),
      });
    }
  }

  async queryFiles(pattern: string, limit = 20): Promise<SearchMatch[]> {
    if (limit <= 0) {
      return [];
    }

    const normalized = normalizeToken(pattern);
    if (!normalized) {
      return [];
    }

    const matches: SearchMatch[] = [];
    for (const document of this.index.values()) {
      const score = rankPath(
        document.path,
        normalized,
        DEFAULT_QUERY_WEIGHTS,
        computeFrecency(ageInHours(document.indexedAt)),
        false,
      );
      if (score === 0) {
        continue;
      }

      matches.push({
        path: document.path,
        score,
        snippet: document.path,
      });
    }

    return matches.sort(compareMatches).slice(0, limit);
  }

  async queryContent(query: string, limit = 20): Promise<SearchMatch[]> {
    if (limit <= 0) {
      return [];
    }

    const normalized = normalizeToken(query);
    if (!normalized) {
      return [];
    }

    const matches: SearchMatch[] = [];
    for (const document of this.index.values()) {
      const lowerContent = document.content.toLowerCase();
      const matchStart = lowerContent.indexOf(normalized);
      if (matchStart === -1) {
        continue;
      }

      matches.push({
        path: document.path,
        score: 1
          + rankPath(
            document.path,
            normalized,
            DEFAULT_QUERY_WEIGHTS,
            computeFrecency(ageInHours(document.indexedAt)),
            false,
          ),
        snippet: extractSnippet(
          document.content,
          matchStart,
          normalized.length,
        ),
      });
    }

    return matches.sort(compareMatches).slice(0, limit);
  }

  rank(
    pattern: string,
    weights: { fuzzy: number; frecency: number; git: number },
  ): number {
    let best = 0;
    for (const document of this.index.values()) {
      best = Math.max(
        best,
        rankPath(
          document.path,
          pattern,
          weights,
          computeFrecency(ageInHours(document.indexedAt)),
          false,
        ),
      );
    }

    return best;
  }
}

export function createSearchService(): SearchService {
  return new InMemorySearchService();
}
