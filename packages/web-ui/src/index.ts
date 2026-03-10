import type { AgentEvent } from "../../core/src/contracts";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export interface ArtifactServerConfig {
  host: string;
  port: number;
  artifactDir?: string;
}

export interface ArtifactSummary {
  id: string;
  name: string;
  bytes: number;
}

export interface AgentEventSource {
  onEvent(listener: (event: AgentEvent) => void): () => void;
}

export interface ArtifactServer {
  start(config: ArtifactServerConfig): Promise<void>;
  stop(): Promise<void>;
  listArtifacts(): Promise<ArtifactSummary[]>;
  uploadArtifact(name: string, content: string | Uint8Array): Promise<ArtifactSummary>;
  downloadArtifact(id: string): Promise<Uint8Array>;
  attachSessionEvents(source: AgentEventSource): void;
}

interface ServerHandle {
  close(): void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class InMemoryArtifactServer implements ArtifactServer {
  private server: ServerHandle | null = null;
  private artifactDir = ".pi/artifacts";
  private readonly events: AgentEvent[] = [];
  private unsubscribe: (() => void) | null = null;

  async start(config: ArtifactServerConfig): Promise<void> {
    this.artifactDir = config.artifactDir ?? this.artifactDir;
    await mkdir(this.artifactDir, { recursive: true });

    if (typeof Bun === "undefined") {
      return;
    }

    if (this.server) {
      return;
    }

    const server = Bun.serve({
      port: config.port,
      hostname: config.host,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/artifacts") {
          return Response.json({ artifacts: await this.listArtifacts() });
        }

        if (request.method === "POST" && url.pathname === "/artifacts") {
          const body = await request.json() as { name?: string; content?: string };
          if (!body.name || !body.content) {
            return Response.json({ error: "name and content are required" }, { status: 400 });
          }
          const artifact = await this.uploadArtifact(body.name, body.content);
          return Response.json(artifact, { status: 201 });
        }

        if (request.method === "GET" && url.pathname.startsWith("/artifacts/")) {
          const id = decodeURIComponent(url.pathname.replace("/artifacts/", ""));
          const bytes = await this.downloadArtifact(id).catch(() => null);
          if (!bytes) {
            return Response.json({ error: "artifact not found" }, { status: 404 });
          }
          return new Response(bytes);
        }

        if (request.method === "GET" && url.pathname === "/events") {
          return Response.json({ events: this.events });
        }

        return Response.json({ ok: true });
      },
    });

    this.server = {
      close: () => server.stop(),
    };
  }

  async stop(): Promise<void> {
    this.server?.close();
    this.server = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async listArtifacts(): Promise<ArtifactSummary[]> {
    await mkdir(this.artifactDir, { recursive: true });
    const files = await readdir(this.artifactDir);
    const artifacts: ArtifactSummary[] = [];
    for (const file of files) {
      const bytes = await readFile(join(this.artifactDir, file));
      artifacts.push({ id: file, name: file, bytes: bytes.byteLength });
    }
    return artifacts;
  }

  async uploadArtifact(name: string, content: string | Uint8Array): Promise<ArtifactSummary> {
    await mkdir(this.artifactDir, { recursive: true });
    const id = `${makeId()}-${basename(name)}`;
    const path = join(this.artifactDir, id);
    const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    await writeFile(path, buffer);
    return { id, name: basename(name), bytes: buffer.byteLength };
  }

  async downloadArtifact(id: string): Promise<Uint8Array> {
    return await readFile(join(this.artifactDir, basename(id)));
  }

  attachSessionEvents(source: AgentEventSource): void {
    this.unsubscribe?.();
    this.unsubscribe = source.onEvent((event) => {
      this.events.push(event);
    });
  }
}

export function createArtifactServer(): ArtifactServer {
  return new InMemoryArtifactServer();
}
