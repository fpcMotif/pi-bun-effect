# ADR 0005: pi-mono compatibility strategy

## Status
- Draft

## Context
pi-mono provides behavior contracts and UX expectations. The goal is strict functional compatibility where feasible, with explicit migration and fallback points.

## Decision
- Keep compatibility as contract-first (session schema, RPC semantics, tool behavior) rather than API-level bundling.
- Reimplement with Effect-first services in Bun.
- Use adapters only where a direct compatibility gap is proven and stable.

## Consequences
- Cleaner architecture with predictable failure modes and explicit contracts.
- Some edge-case extension compatibility is best-effort at launch.
- Conformance fixtures become the source of truth for behavior alignment.
