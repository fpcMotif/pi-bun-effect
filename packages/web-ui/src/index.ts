export interface ArtifactServerConfig {
  host: string;
  port: number;
}

export interface ArtifactRecord {
  id: string;
  sessionId: string;
  name: string;
  createdAt: string;
  url: string;
}

export interface SessionRecord {
  id: string;
  channel?: string;
  startedAt: string;
  status: "active" | "ended";
}

export interface WebUiEvent {
  type: "artifact.created" | "session.updated";
  payload: ArtifactRecord | SessionRecord;
}

export interface ArtifactServer {
  start(config: ArtifactServerConfig): Promise<void>;
  stop(): Promise<void>;
  addArtifact(artifact: ArtifactRecord): void;
  upsertSession(session: SessionRecord): void;
}

interface ServerHandle {
  stop(): void;
}

type SocketClient = {
  send(data: string): number;
};

export class InMemoryArtifactServer implements ArtifactServer {
  private server: ServerHandle | null = null;
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly clients = new Set<SocketClient>();

  async start(config: ArtifactServerConfig): Promise<void> {
    if (typeof Bun === "undefined") {
      return;
    }

    if (this.server) {
      return;
    }

    const server = Bun.serve<{ serverRef: InMemoryArtifactServer }>({
      port: config.port,
      hostname: config.host,
      fetch: (request, runningServer) => {
        const url = new URL(request.url);

        if (url.pathname === "/events") {
          if (runningServer.upgrade(request, { data: { serverRef: this } })) {
            return;
          }
          return new Response("upgrade failed", { status: 400 });
        }

        if (url.pathname === "/artifacts") {
          return Response.json({
            artifacts: Array.from(this.artifacts.values()),
          });
        }

        if (url.pathname === "/sessions") {
          return Response.json({
            sessions: Array.from(this.sessions.values()),
          });
        }

        if (url.pathname === "/health") {
          return Response.json({ ok: true });
        }

        return new Response("not found", { status: 404 });
      },
      websocket: {
        open: (socket) => {
          socket.data.serverRef.clients.add(socket as unknown as SocketClient);
        },
        close: (socket) => {
          socket.data.serverRef.clients.delete(socket as unknown as SocketClient);
        },
      },
    });

    this.server = {
      stop: () => server.stop(),
    };
  }

  private publish(event: WebUiEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients.values()) {
      client.send(message);
    }
  }

  addArtifact(artifact: ArtifactRecord): void {
    this.artifacts.set(artifact.id, artifact);
    this.publish({
      type: "artifact.created",
      payload: artifact,
    });
  }

  upsertSession(session: SessionRecord): void {
    this.sessions.set(session.id, session);
    this.publish({
      type: "session.updated",
      payload: session,
    });
  }

  async stop(): Promise<void> {
    this.server?.stop();
    this.server = null;
    this.clients.clear();
  }
}

export function createArtifactServer(): ArtifactServer {
  return new InMemoryArtifactServer();
}
