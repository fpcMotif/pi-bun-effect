# pi-bun-effect

Bun-first Effect-TS rewrite of `pi-mono` and `pi_agent_rust` with JSONL v3 session compatibility, structured agent runtime, and explicit tool security controls.

## Repo layout

- `packages/*`: workspace packages for runtime modules
- `docs/`: PRD, spec, ADRs, user stories, and test suite plan
- `tests/fixtures`: data-driven unit/conformance fixtures
- `tests/conformance`: protocol and tool conformance fixtures

## Bootstrap (first run)

1. `bun init -y` during repo creation
2. `git init`
3. `bun install`
4. `bun run lint` (placeholder for future lint setup)
5. `bun test` (placeholder test pipeline)

Run from root:
- `bun install`
- `bun run lint`
- `bun test`

## Notes

- This repository is intentionally scaffolded for implementation-first development.
- Behavioral contracts and migration gates are defined in `prd.json`, `spec.md`, and `docs/*`.
