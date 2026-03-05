import { expect, test, describe, afterEach } from "bun:test";
import { InMemoryArtifactServer, createArtifactServer } from "./index.js";

describe("InMemoryArtifactServer", () => {
  let server: InMemoryArtifactServer | null = null;
  const HOST = "127.0.0.1";

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  test("should start server and respond to fetch requests", async () => {
    server = new InMemoryArtifactServer();
    await server.start({ host: HOST, port: 0 });

    const response = await fetch(`http://${HOST}:${server.port}`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ ok: true, artifacts: [] });
  });

  test("should be idempotent on start", async () => {
    server = new InMemoryArtifactServer();
    await server.start({ host: HOST, port: 0 });
    const originalPort = server.port;

    // Starting again shouldn't throw or cause issues
    await server.start({ host: HOST, port: 0 });

    // Ensure it's still running on the same port
    expect(server.port).toBe(originalPort);

    const response = await fetch(`http://${HOST}:${server.port}`);
    expect(response.status).toBe(200);
  });

  test("should stop the server", async () => {
    server = new InMemoryArtifactServer();
    await server.start({ host: HOST, port: 0 });
    const port = server.port;

    // Verify it's running
    const response = await fetch(`http://${HOST}:${port}`, { headers: { "Connection": "close" } });
    expect(response.status).toBe(200);

    // Stop the server
    await server.stop();
    expect(server.port).toBeNull();

    // Fetch should fail now
    let fetchFailed = false;
    try {
      await fetch(`http://${HOST}:${port}`);
    } catch (error) {
      fetchFailed = true;
    }
    expect(fetchFailed).toBe(true);
  });

  test("createArtifactServer factory function", () => {
    const srv = createArtifactServer();
    expect(srv).toBeInstanceOf(InMemoryArtifactServer);
  });
});
