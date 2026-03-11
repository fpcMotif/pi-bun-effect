import { type AgentMessage, isAgentMessage } from "@pi-bun-effect/core";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export type SessionVersion = 1 | 2 | 3;

export interface SessionHeader {
  version: SessionVersion;
  id: string;
  createdAt: string;
  updatedAt?: string;
}

export interface JsonlSessionEntry {
  id: string;
  type: string;
  parentId?: string;
  timestamp: string;
  data: AgentMessage;
}

export interface ParsedSession {
  header: SessionHeader;
  entries: JsonlSessionEntry[];
}

export interface SessionStore {
  open(path: string): Promise<void>;
  readHeader(path: string): Promise<SessionHeader>;
  append(
    path: string,
    entry:
      & Omit<JsonlSessionEntry, "id" | "timestamp">
      & Partial<Pick<JsonlSessionEntry, "id" | "timestamp">>,
  ): Promise<JsonlSessionEntry>;
  readAll(path: string): Promise<JsonlSessionEntry[]>;
  migrate(path: string): Promise<SessionVersion>;
  fork(path: string, branchParentId: string): Promise<string>;
  switch(path: string, entryId: string): Promise<JsonlSessionEntry | null>;
  parent(path: string, entryId: string): Promise<JsonlSessionEntry | null>;
  children(path: string, parentId: string): Promise<JsonlSessionEntry[]>;
  linearizeFrom(path: string, entryId: string): Promise<JsonlSessionEntry[]>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseJsonLine(line: string, index: number): unknown {
  if (!line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`Malformed JSON at line ${index + 1}`);
  }
}

function isHeader(value: unknown): value is SessionHeader {
  return (
    !!value
    && typeof value === "object"
    && "version" in value
    && "id" in value
    && (value as { version: unknown }).version !== undefined
    && [1, 2, 3].includes((value as { version: number }).version)
  );
}

function toEntry(value: unknown): JsonlSessionEntry {
  if (!value || typeof value !== "object") {
    throw new Error("Session entry must be an object");
  }
  const candidate = value as Partial<JsonlSessionEntry>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.type !== "string"
    || typeof candidate.timestamp !== "string"
    || !isAgentMessage(candidate.data)
  ) {
    throw new Error("Invalid session entry");
  }
  return candidate as JsonlSessionEntry;
}

async function readJsonl(text: string): Promise<ParsedSession> {
  const lines = text.split("\n");
  if (lines.length === 0) {
    throw new Error("Session file is empty");
  }

  let headerIndex = 0;
  while (headerIndex < lines.length && !lines[headerIndex]?.trim()) {
    headerIndex++;
  }

  const headerLine = lines[headerIndex];
  if (headerLine === undefined) {
    throw new Error("Session file is empty");
  }

  const parsedHeader = parseJsonLine(headerLine, headerIndex);
  if (!isHeader(parsedHeader)) {
    throw new Error("Invalid session header");
  }

  const header: SessionHeader = {
    version: parsedHeader.version as SessionVersion,
    id: parsedHeader.id,
    createdAt: parsedHeader.createdAt,
    updatedAt: (parsedHeader as SessionHeader).updatedAt,
  };

  const entries: JsonlSessionEntry[] = [];
  const BATCH_SIZE = 5000;
  for (let i = headerIndex + 1; i < lines.length; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE, lines.length);
    for (let j = i; j < end; j++) {
      const line = lines[j];
      if (line === undefined || !line.trim()) {
        continue;
      }

      const parsed = parseJsonLine(line, j);
      if (parsed === null) {
        continue;
      }
      entries.push(toEntry(parsed));
    }

    // Yield to event loop to prevent blocking on large files
    if (end < lines.length) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return { header, entries };
}

export class JsonlSessionStore implements SessionStore {
  async open(path: string): Promise<void> {
    const directory = dirname(path);
    try {
      await access(path);
    } catch {
      await mkdir(directory, { recursive: true });
      const header = {
        version: 3 as const,
        id: `${makeId()}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await writeFile(path, `${JSON.stringify(header)}\n`, "utf8");
    }
  }

  async readHeader(path: string): Promise<SessionHeader> {
    const existing = await this.readAllInternal(path);
    return existing.header;
  }

  async append(
    path: string,
    entry:
      & Omit<JsonlSessionEntry, "id" | "timestamp">
      & Partial<Pick<JsonlSessionEntry, "id" | "timestamp">>,
  ): Promise<JsonlSessionEntry> {
    await this.open(path);
    const prepared = {
      ...entry,
      id: entry.id ?? makeId(),
      timestamp: entry.timestamp ?? nowIso(),
    };
    await appendLine(path, JSON.stringify(prepared));
    return prepared;
  }

  async readAll(path: string): Promise<JsonlSessionEntry[]> {
    return (await this.readAllInternal(path)).entries;
  }

  private async migrateInternal(
    path: string,
    parsed: ParsedSession,
  ): Promise<ParsedSession> {
    if (parsed.header.version === 3) {
      return parsed;
    }

    const migrated: SessionHeader = {
      version: 3,
      id: parsed.header.id,
      createdAt: parsed.header.createdAt,
      updatedAt: nowIso(),
    };
    const body = `${JSON.stringify(migrated)}\n${
      parsed.entries.map((entry) => JSON.stringify(entry)).join("\n")
    }${parsed.entries.length > 0 ? "\n" : ""}`;
    await writeFile(path, body, "utf8");

    return {
      header: migrated,
      entries: parsed.entries,
    };
  }

  async migrate(path: string): Promise<SessionVersion> {
    const raw = await readFile(path, "utf8");
    const parsed = await readJsonl(raw);
    await this.migrateInternal(path, parsed);
    return 3;
  }

  async fork(path: string, branchParentId: string): Promise<string> {
    const entries = await this.readAllInternal(path);
    const target = entries.entries.find((entry) => entry.id === branchParentId);
    if (!target) {
      throw new Error(`branch parent not found: ${branchParentId}`);
    }

    const branched: JsonlSessionEntry = {
      id: makeId(),
      type: target.type,
      parentId: target.id,
      timestamp: nowIso(),
      data: {
        ...target.data,
        id: makeId(),
        timestamp: target.timestamp,
      },
    };
    await this.append(path, branched);
    return branched.id;
  }

  async switch(
    path: string,
    entryId: string,
  ): Promise<JsonlSessionEntry | null> {
    const entries = await this.readAllInternal(path);
    return entries.entries.find((entry) => entry.id === entryId) ?? null;
  }

  async parent(
    path: string,
    entryId: string,
  ): Promise<JsonlSessionEntry | null> {
    return this.getParent(path, entryId);
  }

  async children(path: string, parentId: string): Promise<JsonlSessionEntry[]> {
    return this.listChildren(path, parentId);
  }

  async listChildren(
    path: string,
    parentId: string,
  ): Promise<JsonlSessionEntry[]> {
    const entries = await this.readAllInternal(path);
    return entries.entries.filter((entry) => entry.parentId === parentId);
  }

  async getParent(
    path: string,
    entryId: string,
  ): Promise<JsonlSessionEntry | null> {
    const entries = await this.readAllInternal(path);
    const node = entries.entries.find((entry) => entry.id === entryId);
    if (!node?.parentId) {
      return null;
    }

    return entries.entries.find((entry) => entry.id === node.parentId) ?? null;
  }

  async linearizeFrom(
    path: string,
    entryId: string,
  ): Promise<JsonlSessionEntry[]> {
    const entries = await this.readAllInternal(path);
    const map = new Map<string, JsonlSessionEntry>();
    for (const entry of entries.entries) {
      map.set(entry.id, entry);
    }
    const chain: JsonlSessionEntry[] = [];
    let current: JsonlSessionEntry | undefined = map.get(entryId);

    while (current) {
      chain.push(current);
      current = current.parentId ? map.get(current.parentId) : undefined;
    }

    return chain.reverse();
  }

  private async readAllInternal(path: string): Promise<ParsedSession> {
    await this.open(path);
    const raw = await readFile(path, "utf8");
    const parsed = await readJsonl(raw);
    if (parsed.header.version !== 3) {
      return this.migrateInternal(path, parsed);
    }
    return parsed;
  }
}

export function createSessionStore(_rootDirectory = ""): SessionStore {
  return new JsonlSessionStore();
}

async function appendLine(path: string, line: string): Promise<void> {
  await appendFile(path, `${line}\n`, "utf8");
}
