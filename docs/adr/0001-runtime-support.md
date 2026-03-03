# ADR 0001: Runtime target and compatibility strategy

## Status
- Draft

## Context
Bun is the primary target for the initial release, with Node compatibility kept as an explicit decision point. Bun is selected to reduce runtime overhead and improve startup/reliability while preserving TypeScript compatibility where needed.

## Decision
- Adopt Bun as the default and primary runtime for launch (`bun run`, Bun tooling, Bun.serve, bun:sqlite).
- Document Node compatibility as follow-up scope (opt-in compatibility shims only, not baseline guarantees).

## Consequences
- We gain Bun-native performance, single runtime surface, and simpler dependency control.
- Some Node-focused libraries may require adaptation or substitution.
- Operators needing Node compatibility can be served via a separate compatibility layer in follow-up milestones.
