import { createSearchService, type SearchService } from "@pi-bun-effect/search";
import { relative } from "node:path";

export interface TuiCommandContext {
  commandText: string;
  args: string[];
}

export interface TuiSession {
  mount(): Promise<void>;
  stop(): Promise<void>;
  onFileReferenceQuery(query: string): Promise<string[]>;
}

interface TuiSessionOptions {
  cwd?: string;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  searchService?: SearchService;
}

export class InteractiveTuiSession implements TuiSession {
  private readonly cwd: string;
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.WriteStream;
  private readonly search: SearchService;
  private running = false;

  constructor(options: TuiSessionOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.search = options.searchService ?? createSearchService();
  }

  async mount(): Promise<void> {
    this.running = true;
    await this.search.buildIndex(this.cwd);
    this.write("pi-bun-effect interactive mode\n");
    this.write("Type /help for commands. Use @ to lookup files.\n");

    if (this.input.isTTY) {
      await this.runTtyLoop();
      return;
    }

    const text = await new Response(this.input).text();
    await this.runScriptedLoop(text);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.input.isTTY && typeof this.input.setRawMode === "function") {
      this.input.setRawMode(false);
    }
  }

  async onFileReferenceQuery(query: string): Promise<string[]> {
    const matches = await this.search.queryFiles(query, 5);
    return matches.map((match) => relative(this.cwd, match.path));
  }

  private async runScriptedLoop(text: string): Promise<void> {
    const chunks = text.split(/\r?\n/);
    const multi: string[] = [];
    for (const rawLine of chunks) {
      if (!this.running) break;
      if (rawLine.endsWith("\\")) {
        multi.push(rawLine.slice(0, -1));
        continue;
      }

      multi.push(rawLine);
      const line = multi.join("\n").trim();
      multi.length = 0;
      if (line.length === 0) continue;
      await this.handleLine(line);
    }
  }

  private async runTtyLoop(): Promise<void> {
    let buffer = "";
    if (typeof this.input.setRawMode === "function") {
      this.input.setRawMode(true);
    }
    this.input.resume();
    this.renderPrompt(buffer);

    await new Promise<void>((resolve) => {
      const onData = async (chunk: Buffer) => {
        const token = chunk.toString("utf8");

        if (token === "\u0003") {
          await this.stop();
          this.write("\n");
          this.input.off("data", onData);
          resolve();
          return;
        }

        if (token === "\r") {
          this.write("\n");
          const line = buffer.trim();
          buffer = "";
          if (line.length > 0) {
            await this.handleLine(line);
          }
          if (!this.running) {
            this.input.off("data", onData);
            resolve();
            return;
          }
          this.renderPrompt(buffer);
          return;
        }

        if (token === "\u001b\r") {
          buffer += "\n";
          this.renderPrompt(buffer);
          return;
        }

        if (token === "\u007f") {
          buffer = buffer.slice(0, -1);
          this.renderPrompt(buffer);
          return;
        }

        if (token >= " " || token === "\n") {
          buffer += token;
          this.renderPrompt(buffer);
        }
      };

      this.input.on("data", (chunk) => {
        void onData(chunk);
      });
    });
  }

  private async handleLine(line: string): Promise<void> {
    if (line.startsWith("/")) {
      await this.handleSlashCommand(line);
      return;
    }

    await this.streamAssistant(`echo: ${line}`);

    const atMatch = line.match(/@([^\s]+)/);
    if (atMatch) {
      const suggestions = await this.onFileReferenceQuery(atMatch[1]);
      if (suggestions.length > 0) {
        this.write(`\nfile suggestions (${atMatch[1]}):\n`);
        for (const suggestion of suggestions) {
          this.write(` - ${suggestion}\n`);
        }
      }
    }
  }

  private async handleSlashCommand(line: string): Promise<void> {
    const [commandText, ...args] = line.slice(1).split(/\s+/);
    const context: TuiCommandContext = { commandText, args };

    if (context.commandText === "help") {
      this.write("commands: /help, /exit, /files <query>\n");
      return;
    }

    if (context.commandText === "files") {
      const query = context.args.join(" ").trim();
      const results = await this.onFileReferenceQuery(query);
      if (results.length === 0) {
        this.write("no file matches\n");
        return;
      }
      this.write(`matches for '${query}':\n`);
      for (const result of results) {
        this.write(` - ${result}\n`);
      }
      return;
    }

    if (context.commandText === "exit") {
      this.write("bye\n");
      await this.stop();
      return;
    }

    this.write(`unknown command: /${context.commandText}\n`);
  }

  private async streamAssistant(message: string): Promise<void> {
    this.write("assistant> ");
    for (const char of message) {
      this.write(char);
    }
    this.write("\n");
  }

  private renderPrompt(buffer: string): void {
    const rendered = buffer.replace(/\n/g, "\\n");
    this.write(`\r> ${rendered}\u001b[K`);
  }

  private write(text: string): void {
    this.output.write(text);
  }
}

export function createTuiSession(options: TuiSessionOptions = {}): TuiSession {
  return new InteractiveTuiSession(options);
}
