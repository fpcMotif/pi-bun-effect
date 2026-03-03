# ADR 0003: Extension execution model

## Status

- Draft

## Context

Current extension ecosystems vary in trust and risk. pi-mono docs indicate powerful extension capabilities while pi_agent_rust emphasizes explicit mediation.

## Decision

- Ship default safe-mode execution with explicit capability declarations.
- Preserve in-process extension API initially for developer usability.
- Add optional escalation paths by policy:
  - Bun worker isolation
  - process isolation
  - WASM execution tier (as a future hardening option)

## Consequences

- Safer default behavior without blocking extension adoption.
- Additional runtime modes allow operators to balance performance and isolation.
- Trust model and audit logs become mandatory surfaces for extension state transitions.
