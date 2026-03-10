import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SearchIndexConfig {
  sessionDbPath: string;
}

export interface SearchIndex {
  init(config: SearchIndexConfig): Promise<void>;
  upsertSession(
    sessionId: string,
    entryId: string,
    text: string,
  ): Promise<void>;
  querySessions(
    query: string,
    limit?: number,
  ): Promise<Array<{ sessionId: string; score: number }>>;
}

interface SessionIndexRow {
  sessionId: string;
  entryId: string;
  text: string;
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function scoreMatch(text: string, query: string): number {
  return text.includes(query) ? 1 : 0;
}

export class InMemorySessionIndex implements SearchIndex {
  private path = "";
  private rows: SessionIndexRow[] = [];
  private ready = false;

  async init(config: SearchIndexConfig): Promise<void> {
    this.path = config.sessionDbPath;
    this.ready = true;
  }

  async upsertSession(
    sessionId: string,
    entryId: string,
    text: string,
  ): Promise<void> {
    if (!this.ready) {
      throw new Error("index not initialized");
    }
    const normalized = this.rows.filter(
      (row) => row.entryId !== entryId || row.sessionId !== sessionId,
    );
    this.rows = normalized;
    this.rows.push({ sessionId, entryId, text: normalize(text) });
  }

  async querySessions(
    query: string,
    limit = 20,
  ): Promise<Array<{ sessionId: string; score: number }>> {
    if (!this.ready) {
      return [];
    }
    const normalized = normalize(query);
    const scores = new Map<string, number>();
    for (const row of this.rows) {
      const score = scoreMatch(row.text, normalized);
      if (score > 0) {
        scores.set(row.sessionId, (scores.get(row.sessionId) ?? 0) + score);
      }
    }

    return [...scores.entries()]
      .map(([sessionId, score]) => ({ sessionId, score }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.sessionId.localeCompare(right.sessionId);
      })
      .slice(0, limit);
  }

  get dbPath(): string {
    return this.path;
  }
}

export class SqliteSessionIndex implements SearchIndex {
  private db: Database | null = null;

  async init(config: SearchIndexConfig): Promise<void> {
    if (this.db) {
      this.db.close();
    }

    const directory = dirname(config.sessionDbPath);
    mkdirSync(directory, { recursive: true });

    this.db = new Database(config.sessionDbPath, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_index (
        session_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        text TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, entry_id)
      );
    `);
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_session_index_session_id ON session_index(session_id);",
    );
  }

  async upsertSession(
    sessionId: string,
    entryId: string,
    text: string,
  ): Promise<void> {
    const db = this.requireDb();
    const normalized = normalize(text);
    db
      .query(
        `
          INSERT INTO session_index (session_id, entry_id, text, updated_at)
          VALUES (?1, ?2, ?3, datetime('now'))
          ON CONFLICT(session_id, entry_id)
          DO UPDATE SET text = excluded.text, updated_at = datetime('now');
        `,
      )
      .run(sessionId, entryId, normalized);
  }

  async querySessions(
    query: string,
    limit = 20,
  ): Promise<Array<{ sessionId: string; score: number }>> {
    const db = this.requireDb();
    const normalized = normalize(query);
    if (!normalized) {
      return [];
    }

    const rows = db
      .query(
        `
          SELECT
            session_id AS sessionId,
            COUNT(*) AS score
          FROM session_index
          WHERE instr(text, ?1) > 0
          GROUP BY session_id
          ORDER BY score DESC, session_id ASC
          LIMIT ?2;
        `,
      )
      .all(normalized, limit) as Array<{ sessionId: string; score: number }>;

    return rows;
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error("index not initialized");
    }
    return this.db;
  }
}

export interface SessionIndexFactoryOptions {
  backend?: "sqlite" | "memory";
}

export function createSessionIndex(
  options: SessionIndexFactoryOptions = {},
): SearchIndex {
  if (options.backend === "memory") {
    return new InMemorySessionIndex();
  }
  return new SqliteSessionIndex();
}
