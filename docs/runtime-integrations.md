# Runtime Integrations: Pods, Slack Bot, and Web UI

This document describes operational setup for the runtime integration surfaces added in the monorepo.

## Pods runtime (`@pi-bun-effect/pods`)

### Configuration

The pod manager now supports persistent configuration through `configPath`.

```ts
import { createPodManager } from "@pi-bun-effect/pods";

const pods = createPodManager({
  configPath: ".state/pod-config.json",
  basePort: 11434,
});
```

### Runtime orchestration

`setup`, `startModel`, `stopModel`, `listModels`, and `logs` all execute explicit shell command orchestration through the command runner.

* `setup` creates remote runtime directories.
* `startModel` launches vLLM over SSH.
* `stopModel` sends a kill signal for the model process.
* `listModels` reads model entries from remote storage.
* `logs` tails model runtime logs.

If `configPath` is set, pod settings are written to disk and loaded on process restart.

## Slack bot runtime (`@pi-bun-effect/slack-bot`)

### Event ingestion adapter

Use `ingestEvent` for raw Slack payloads. It handles:

* `url_verification` challenge flow.
* `event_callback` message events.

### Session mapping

Channel IDs map to stable runtime session IDs (`slack-<channelId>`), allowing per-channel continuity.

### Tool policy restrictions

The bot supports:

* global default allow-list (`defaultAllowedTools`),
* per-channel allow-list (`channelAllowedTools`),
* global deny-list (`deniedTools`, highest precedence).

## Web UI runtime (`@pi-bun-effect/web-ui`)

### Endpoints

When running, the server exposes:

* `GET /health`
* `GET /sessions`
* `GET /artifacts`
* `WS /events`

### Event streaming

Websocket clients receive JSON events whenever:

* a session is added/updated (`session.updated`),
* an artifact is added (`artifact.created`).

### Minimal bootstrap

```ts
import { createArtifactServer } from "@pi-bun-effect/web-ui";

const ui = createArtifactServer();
await ui.start({ host: "127.0.0.1", port: 3000 });
```

Then feed runtime state:

```ts
ui.upsertSession({
  id: "sess-1",
  startedAt: new Date().toISOString(),
  status: "active",
});

ui.addArtifact({
  id: "a1",
  sessionId: "sess-1",
  name: "run.log",
  createdAt: new Date().toISOString(),
  url: "/artifacts/a1",
});
```
