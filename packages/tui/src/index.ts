export interface TuiCommandContext {
  commandText: string;
  args: string[];
}

export interface TuiSession {
  mount(): Promise<void>;
  stop(): Promise<void>;
  onFileReferenceQuery(query: string): Promise<string[]>;
}
