export interface SearchIndexConfig {
  sessionDbPath: string;
}

export interface SearchIndex {
  init(config: SearchIndexConfig): Promise<void>;
  upsertSession(sessionId: string, entryId: string, text: string): Promise<void>;
  querySessions(query: string, limit?: number): Promise<Array<{ sessionId: string; score: number }>>;
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

  async upsertSession(sessionId: string, entryId: string, text: string): Promise<void> {
    if (!this.ready) {
      throw new Error("index not initialized");
    }
    const normalized = this.rows.filter((row) => row.entryId !== entryId || row.sessionId !== sessionId);
    this.rows = normalized;
    this.rows.push({ sessionId, entryId, text: text.toLowerCase() });
  }

  async querySessions(query: string, limit = 20): Promise<Array<{ sessionId: string; score: number }>> {
    if (!this.ready) {
      return [];
    }
    const normalized = query.toLowerCase();
    return this.rows
      .map((row) => ({ sessionId: row.sessionId, score: row.text.includes(normalized) ? 1 : 0 }))
      .filter((row) => row.score > 0)
      .slice(0, limit);
  }

  get dbPath(): string {
    return this.path;
  }
}

export function createSessionIndex(): SearchIndex {
  return new InMemorySessionIndex();
}
