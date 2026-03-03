import { readdir } from "node:fs/promises";
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

export function rankPath(
  path: string,
  pattern: string,
  weights: SearchWeights,
  frecency = 1,
  isGitDirty = false,
): number {
  const normalizedPath = normalizeToken(path);
  const normalizedPattern = normalizeToken(pattern);
  const contains = normalizedPath.includes(normalizedPattern) ? 1 : 0;
  const gitBoost = isGitDirty ? 1 : 0;
  return (
    contains * weights.fuzzy
    + computeFrecency(0) * weights.frecency
    + gitBoost * weights.git
  );
}

export class InMemorySearchService implements SearchService {
  private readonly index = new Map<string, number>();

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
      const timestamp = Date.now();
      this.index.set(fullPath, timestamp);
    }
  }

  async queryFiles(pattern: string, limit = 20): Promise<SearchMatch[]> {
    const normalized = normalizeToken(pattern);
    const matches = Array.from(this.index.keys())
      .map((path) => ({
        path,
        score: path.toLowerCase().includes(normalized) ? 1 : 0,
        snippet: path,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return matches;
  }

  async queryContent(query: string, limit = 20): Promise<SearchMatch[]> {
    const normalized = normalizeToken(query);
    const matches = Array.from(this.index.keys())
      .map((path) => ({
        path,
        score: path.toLowerCase().includes(normalized) ? 1 : 0,
        snippet: path,
      }))
      .filter((entry) => entry.score > 0)
      .slice(0, limit);
    return matches;
  }

  rank(
    pattern: string,
    weights: { fuzzy: number; frecency: number; git: number },
  ): number {
    const best = this.index.size === 0 ? 0 : 1;
    return (
      rankPath(
        Array.from(this.index.keys())[0] ?? "",
        pattern,
        weights,
        1,
        false,
      ) * best
    );
  }
}

export function createSearchService(): SearchService {
  return new InMemorySearchService();
}
