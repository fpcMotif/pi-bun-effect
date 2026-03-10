import { createArtifactServer } from "../../packages/web-ui/src/index";
import { expect, test } from "bun:test";

function testPort(): number {
  return 41000 + Math.floor(Math.random() * 1000);
}

test("integration: web-ui serves sessions/artifacts and streams websocket events", async () => {
  if (typeof Bun === "undefined") {
    return;
  }

  const server = createArtifactServer();
  const port = testPort();
  await server.start({ host: "127.0.0.1", port });

  const wsMessage = new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
    ws.addEventListener("open", () => {
      server.upsertSession({
        id: "sess-1",
        channel: "C123",
        startedAt: new Date().toISOString(),
        status: "active",
      });
    });
    ws.addEventListener("message", (event) => {
      resolve(String(event.data));
      ws.close();
    });
    ws.addEventListener("error", () => {
      reject(new Error("websocket failed"));
    });
  });

  server.addArtifact({
    id: "a1",
    sessionId: "sess-1",
    name: "trace.json",
    createdAt: new Date().toISOString(),
    url: "/artifacts/a1",
  });

  const streamed = JSON.parse(await wsMessage) as { type: string };

  const sessionsResponse = await fetch(`http://127.0.0.1:${port}/sessions`);
  const artifactsResponse = await fetch(`http://127.0.0.1:${port}/artifacts`);
  const sessionsJson = await sessionsResponse.json();
  const artifactsJson = await artifactsResponse.json();

  expect(sessionsJson.sessions).toHaveLength(1);
  expect(artifactsJson.artifacts).toHaveLength(1);
  expect(streamed.type).toBe("session.updated");

  await server.stop();
});
