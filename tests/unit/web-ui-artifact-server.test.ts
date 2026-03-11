import {
  createArtifactServer,
  InMemoryArtifactServer,
} from "@pi-bun-effect/web-ui";
import { afterEach, describe, expect, test } from "bun:test";

describe("InMemoryArtifactServer", () => {
  let server: InMemoryArtifactServer | null = null;
  const host = "127.0.0.1";

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("starts on an OS-assigned port and responds to fetch requests", async () => {
    server = new InMemoryArtifactServer();
    await server.start({ host, port: 0 });

    const response = await fetch(`http://${host}:${server.port}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, artifacts: [] });
  });

  test("is idempotent on repeated start calls", async () => {
    server = new InMemoryArtifactServer();
    await server.start({ host, port: 0 });
    const originalPort = server.port;

    await server.start({ host, port: 0 });

    expect(server.port).toBe(originalPort);
    expect((await fetch(`http://${host}:${server.port}`)).status).toBe(200);
  });

  test("stops the server and resets the bound port", async () => {
    server = new InMemoryArtifactServer();
    await server.start({ host, port: 0 });
    const port = server.port;

    const response = await fetch(`http://${host}:${port}`, {
      headers: { Connection: "close" },
    });
    expect(response.status).toBe(200);

    await server.stop();
    expect(server.port).toBeNull();

    let fetchFailed = false;
    try {
      await fetch(`http://${host}:${port}`);
    } catch {
      fetchFailed = true;
    }
    expect(fetchFailed).toBeTrue();
  });

  test("createArtifactServer returns an InMemoryArtifactServer", () => {
    expect(createArtifactServer()).toBeInstanceOf(InMemoryArtifactServer);
  });
});
