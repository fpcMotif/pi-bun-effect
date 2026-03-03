export interface ArtifactServerConfig {
  host: string;
  port: number;
}

export interface ArtifactServer {
  start(config: ArtifactServerConfig): Promise<void>;
  stop(): Promise<void>;
}

interface ServerHandle {
  close(): void;
}

export class InMemoryArtifactServer implements ArtifactServer {
  private server: ServerHandle | null = null;

  async start(config: ArtifactServerConfig): Promise<void> {
    if (typeof Bun === "undefined") {
      return;
    }

    if (this.server) {
      return;
    }

    const server = Bun.serve({
      port: config.port,
      hostname: config.host,
      fetch() {
        return Response.json({ ok: true, artifacts: [] });
      }
    });

    this.server = {
      close: () => server.stop()
    };
  }

  async stop(): Promise<void> {
    this.server?.close();
    this.server = null;
  }
}

export function createArtifactServer(): ArtifactServer {
  return new InMemoryArtifactServer();
}
