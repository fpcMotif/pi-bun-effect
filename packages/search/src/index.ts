import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const SEARCHABLE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".graphql",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".md",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const MAX_CONTENT_FILE_BYTES = 512 * 1024;
const LARGE_REPO_THRESHOLD = 400;

interface IndexedFile {
  indexedAt: number;
  mtimeMs: number;
  size: number;
}

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
  return contains * weights.fuzzy + frecency * weights.frecency + gitBoost * weights.git;
}

function extractSnippet(content: string, query: string): string {
  const normalizedQuery = normalizeToken(query);
  const normalizedContent = content.toLowerCase();
  const idx = normalizedContent.indexOf(normalizedQuery);
  if (idx < 0) {
    return content.slice(0, 120).replaceAll("\n", " ");
  }
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + query.length + 40);
  return content.slice(start, end).replaceAll("\n", " ").trim();
}

function isPathTextLike(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext.length === 0 || SEARCHABLE_EXTENSIONS.has(ext);
}

async function isLikelyTextFile(filePath: string): Promise<boolean> {
  if (!isPathTextLike(filePath)) {
    return false;
  }
  try {
    const handle = await open(filePath, "r");
    const probe = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
    await handle.close();
    return !probe.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  }
}

export class InMemorySearchService implements SearchService {
  private readonly index = new Map<string, IndexedFile>();
  private root = "";

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

  private async gitDirtyFiles(): Promise<Set<string>> {
    if (!this.root) {
      return new Set();
    }
    try {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
        cwd: this.root,
      });
      const dirty = new Set<string>();
      for (const line of stdout.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const candidate = line.slice(3).trim();
        if (candidate) {
          dirty.add(resolve(this.root, candidate));
        }
      }
      return dirty;
    } catch {
      return new Set();
    }
  }

  private frecencyFor(meta: IndexedFile): number {
    const ageMs = Date.now() - Math.max(meta.mtimeMs, meta.indexedAt);
    const ageHours = ageMs / (60 * 60 * 1000);
    return computeFrecency(ageHours);
  }

  private scoreForPath(
    path: string,
    pattern: string,
    weights: SearchWeights,
    dirtyFiles: Set<string>,
  ): number {
    const meta = this.index.get(path);
    const frecency = meta ? this.frecencyFor(meta) : 1;
    return rankPath(path, pattern, weights, frecency, dirtyFiles.has(path));
  }

  async buildIndex(root: string): Promise<void> {
    this.root = resolve(root);
    this.index.clear();
    const files = await this.collectFiles(root);
    for (const fullPath of files) {
      try {
        const fileStat = await stat(fullPath);
        this.index.set(fullPath, {
          indexedAt: Date.now(),
          mtimeMs: fileStat.mtimeMs,
          size: fileStat.size,
        });
      } catch {
        // ignore file races while indexing
      }
    }
  }

  async queryFiles(pattern: string, limit = 20): Promise<SearchMatch[]> {
    const normalized = normalizeToken(pattern);
    const dirty = await this.gitDirtyFiles();
    const weights: SearchWeights = { fuzzy: 1, frecency: 0.2, git: 0.3 };

    const matches = Array.from(this.index.keys())
      .map((path) => ({
        path,
        score: this.scoreForPath(path, normalized, weights, dirty),
        snippet: path,
      }))
      .filter((entry) => entry.path.toLowerCase().includes(normalized))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return matches;
  }

  private async queryContentWithGrep(query: string, limit: number): Promise<SearchMatch[]> {
    if (!this.root) {
      return [];
    }
    try {
      const { stdout } = await execFileAsync("grep", [
        "-RIn",
        "--exclude-dir=.git",
        "--exclude-dir=node_modules",
        "--binary-files=without-match",
        "--",
        query,
        this.root,
      ]);
      const dirty = await this.gitDirtyFiles();
      const weights: SearchWeights = { fuzzy: 0.8, frecency: 0.3, git: 0.5 };
      return stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const first = line.indexOf(":");
          const second = line.indexOf(":", first + 1);
          const path = first > 0 ? line.slice(0, first) : "";
          const matchedLine = second > first ? line.slice(second + 1) : line;
          return {
            path,
            score: this.scoreForPath(path, query, weights, dirty),
            snippet: extractSnippet(matchedLine, query),
          } satisfies SearchMatch;
        })
        .filter((entry) => entry.path.length > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async queryContent(query: string, limit = 20): Promise<SearchMatch[]> {
    const normalized = normalizeToken(query);
    if (this.index.size > LARGE_REPO_THRESHOLD) {
      const fastPath = await this.queryContentWithGrep(normalized, limit);
      if (fastPath.length > 0) {
        return fastPath;
      }
    }

    const dirty = await this.gitDirtyFiles();
    const weights: SearchWeights = { fuzzy: 0.8, frecency: 0.3, git: 0.5 };
    const matches: SearchMatch[] = [];

    for (const [path, meta] of this.index.entries()) {
      if (meta.size > MAX_CONTENT_FILE_BYTES) {
        continue;
      }
      if (!(await isLikelyTextFile(path))) {
        continue;
      }
      try {
        const content = await readFile(path, "utf8");
        if (!content.toLowerCase().includes(normalized)) {
          continue;
        }
        matches.push({
          path,
          score: this.scoreForPath(path, normalized, weights, dirty),
          snippet: extractSnippet(content, normalized),
        });
      } catch {
        // ignore deleted/unreadable files
      }
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  rank(
    pattern: string,
    weights: { fuzzy: number; frecency: number; git: number },
  ): number {
    if (this.index.size === 0) {
      return 0;
    }
    const dirty = new Set<string>();
    let best = 0;
    for (const [path, meta] of this.index.entries()) {
      const score = rankPath(
        path,
        pattern,
        weights,
        this.frecencyFor(meta),
        dirty.has(path),
      );
      best = Math.max(best, score);
    }
    return best;
  }
}

export function createSearchService(): SearchService {
  return new InMemorySearchService();
}
