# Runtime Constraints

This project currently targets Bun-first execution for local development and CI.

## Supported runtimes

- **Bun** is the primary and fully supported runtime.
- **Node.js** is partially supported for non-server modules but may skip Bun-only APIs.

## Package-specific constraints

- `packages/web-ui` uses `Bun.serve` when available; in non-Bun environments, server startup is a no-op and filesystem artifact APIs remain available.
- `packages/pods` executes lifecycle shell commands (`setup/start/stop/logs`) and expects `sh` and command-line tooling to be present.
- `packages/slack-bot` persists channel mapping and per-channel event logs to local JSONL files through `@pi-bun-effect/session` and therefore requires filesystem write access.

## Persistence assumptions

- Slack channel mappings and logs default to `.pi/slack/`.
- Pod manager state defaults to `.pi/pods/state.json`.
- Artifact uploads default to `.pi/artifacts/`.

## Operational notes

- Running in ephemeral environments will reset pod/slack/artifact state unless these paths are mounted to persistent volumes.
- Lifecycle command failures include both command text and normalized stderr/stdout for easier diagnostics.
