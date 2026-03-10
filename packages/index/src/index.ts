export interface SearchIndexConfig {
  sessionDbPath: string;
}

export type IndexBackend = "memory" | "sqlite";

export interface SearchIndexHealth {
  backend: IndexBackend;
  ready: boolean;
  persistent: boolean;
  details?: string;
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
  health(): SearchIndexHealth;
}

interface SessionIndexRow {
  sessionId: string;
  entryId: string;
  text: string;
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
    this.rows.push({ sessionId, entryId, text: text.toLowerCase() });
  }

  async querySessions(
    query: string,
    limit = 20,
  ): Promise<Array<{ sessionId: string; score: number }>> {
    if (!this.ready) {
      return [];
    }
    const normalized = query.toLowerCase();
    return this.rows
      .map((row) => ({
        sessionId: row.sessionId,
        score: row.text.includes(normalized) ? 1 : 0,
      }))
      .filter((row) => row.score > 0)
      .slice(0, limit);
  }

  health(): SearchIndexHealth {
    return {
      backend: "memory",
      ready: this.ready,
      persistent: false,
      details: this.ready ? "in-memory fallback active" : "not initialized",
    };
  }

  get dbPath(): string {
    return this.path;
  }
}

interface SqliteStatement<TParams extends unknown[] = unknown[]> {
  run(...params: TParams): void;
  all(...params: TParams): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  query(sql: string): SqliteStatement;
  close(): void;
}

interface BunSqliteModule {
  Database: new (path: string) => SqliteDatabase;
}

const INDEX_SCHEMA_VERSION = 1;

export class SqliteSessionIndex implements SearchIndex {
  private dbPath = "";
  private db: SqliteDatabase | null = null;

  async init(config: SearchIndexConfig): Promise<void> {
    const sqlite = await loadBunSqlite();
    this.dbPath = config.sessionDbPath;
    this.db = new sqlite.Database(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.runMigrations();
  }

  async upsertSession(
    sessionId: string,
    entryId: string,
    text: string,
  ): Promise<void> {
    const db = this.getDb();
    const normalizedText = text.toLowerCase();
    const now = new Date().toISOString();

    db.query(
      `INSERT INTO sessions (session_id, entry_count, updated_at)
       VALUES (?, 1, ?)
       ON CONFLICT(session_id)
       DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(sessionId, now);

    db.query(
      `INSERT INTO session_entries (session_id, entry_id, text, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, entry_id)
       DO UPDATE SET
         text = excluded.text,
         updated_at = excluded.updated_at`,
    ).run(sessionId, entryId, normalizedText, now);

    db.query(
      `UPDATE sessions
       SET entry_count = (
         SELECT COUNT(*) FROM session_entries WHERE session_id = ?
       ),
       updated_at = ?
       WHERE session_id = ?`,
    ).run(sessionId, now, sessionId);
  }

  async querySessions(
    query: string,
    limit = 20,
  ): Promise<Array<{ sessionId: string; score: number }>> {
    const db = this.getDb();
    const normalizedQuery = `%${query.toLowerCase()}%`;
    const rows = db
      .query(
        `SELECT
           session_id AS sessionId,
           COUNT(*) AS score
         FROM session_entries
         WHERE text LIKE ?
         GROUP BY session_id
         ORDER BY score DESC, session_id ASC
         LIMIT ?`,
      )
      .all(normalizedQuery, limit) as Array<{
      sessionId: string;
      score: number;
    }>;
    return rows;
  }

  health(): SearchIndexHealth {
    return {
      backend: "sqlite",
      ready: this.db !== null,
      persistent: true,
      details: this.dbPath || "not initialized",
    };
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private getDb(): SqliteDatabase {
    if (!this.db) {
      throw new Error("index not initialized");
    }
    return this.db;
  }

  private runMigrations(): void {
    const db = this.getDb();
    db.exec(
      `CREATE TABLE IF NOT EXISTS index_meta (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       );`,
    );

    const currentVersionRow = db
      .query(`SELECT value FROM index_meta WHERE key = 'schema_version'`)
      .all() as Array<{ value: string }>;
    const currentVersion = Number(currentVersionRow[0]?.value ?? "0");

    if (currentVersion >= INDEX_SCHEMA_VERSION) {
      return;
    }

    db.exec(
      `CREATE TABLE IF NOT EXISTS sessions (
         session_id TEXT PRIMARY KEY,
         entry_count INTEGER NOT NULL DEFAULT 0,
         updated_at TEXT NOT NULL
       );`,
    );

    db.exec(
      `CREATE TABLE IF NOT EXISTS session_entries (
         session_id TEXT NOT NULL,
         entry_id TEXT NOT NULL,
         text TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         PRIMARY KEY (session_id, entry_id),
         FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
       );`,
    );

    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_session_entries_text
       ON session_entries(text);`,
    );

    db.query(
      `INSERT INTO index_meta (key, value)
       VALUES ('schema_version', ?)
       ON CONFLICT(key)
       DO UPDATE SET value = excluded.value`,
    ).run(String(INDEX_SCHEMA_VERSION));
  }
}

export interface CreateSessionIndexOptions {
  backend?: "auto" | IndexBackend;
}

export async function createSessionIndex(
  options: CreateSessionIndexOptions = {},
): Promise<SearchIndex> {
  const requested = options.backend ?? "auto";
  if (requested === "memory") {
    return new InMemorySessionIndex();
  }

  if (requested === "sqlite" || requested === "auto") {
    const sqliteAvailable = await canUseBunSqlite();
    if (sqliteAvailable) {
      return new SqliteSessionIndex();
    }
  }

  return new InMemorySessionIndex();
}

let sqliteModulePromise: Promise<BunSqliteModule> | null = null;

async function loadBunSqlite(): Promise<BunSqliteModule> {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import("bun:sqlite") as Promise<BunSqliteModule>;
  }
  return sqliteModulePromise;
}

async function canUseBunSqlite(): Promise<boolean> {
  try {
    await loadBunSqlite();
    return true;
  } catch {
    return false;
  }
}
