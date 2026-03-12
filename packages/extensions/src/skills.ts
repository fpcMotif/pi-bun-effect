import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  type: "skill" | "prompt" | "theme";
}

export interface SkillsDiscovery {
  scan(roots: string[]): Promise<SkillMetadata[]>;
  get(name: string): SkillMetadata | undefined;
  list(): SkillMetadata[];
}

const MARKER_FILES: Record<string, SkillMetadata["type"]> = {
  "SKILL.md": "skill",
  "PROMPT.md": "prompt",
  "THEME.md": "theme",
};

async function parseMetadata(
  filePath: string,
  type: SkillMetadata["type"],
): Promise<SkillMetadata> {
  const content = await readFile(filePath, "utf8");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  let name = "";
  let description = "";

  if (frontmatter?.[1]) {
    const lines = frontmatter[1].split("\n");
    for (const line of lines) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (key?.trim() === "name") name = value;
      if (key?.trim() === "description") description = value;
    }
  }

  if (!name) {
    name = filePath.split("/").at(-2) ?? "unknown";
  }

  return { name, description, path: filePath, type };
}

export class InMemorySkillsDiscovery implements SkillsDiscovery {
  private readonly registry = new Map<string, SkillMetadata>();

  async scan(roots: string[]): Promise<SkillMetadata[]> {
    this.registry.clear();
    const results: SkillMetadata[] = [];

    for (const root of roots) {
      const resolved = resolve(root);
      let items: { name: string; isDirectory(): boolean }[];
      try {
        const raw = await readdir(resolved, { withFileTypes: true });
        items = raw.map((d) => ({
          name: String(d.name),
          isDirectory: () => d.isDirectory(),
        }));
      } catch {
        continue;
      }

      const entryPromises = items.map(async (entry) => {
        if (!entry.isDirectory()) return [];
        const dirPath = join(resolved, entry.name);
        const markerPromises = Object.entries(MARKER_FILES).map(
          async ([marker, type]) => {
            const markerPath = join(dirPath, marker);
            try {
              return await parseMetadata(markerPath, type);
            } catch {
              return null; // marker not found, skip
            }
          },
        );
        const metas = await Promise.all(markerPromises);
        return metas.filter((m): m is SkillMetadata => m !== null);
      });

      const entryResults = await Promise.all(entryPromises);
      for (const metas of entryResults) {
        for (const meta of metas) {
          this.registry.set(meta.name, meta);
          results.push(meta);
        }
      }
    }

    return results;
  }

  get(name: string): SkillMetadata | undefined {
    return this.registry.get(name);
  }

  list(): SkillMetadata[] {
    return Array.from(this.registry.values());
  }
}

export function createSkillsDiscovery(): SkillsDiscovery {
  return new InMemorySkillsDiscovery();
}
