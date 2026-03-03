# ADR 0002: LLM provider scope and auth strategy

## Status
- Draft

## Context
v1 launch needs stable provider coverage with low operational complexity while supporting extensibility.

## Decision
- GA baseline includes OpenAI-compatible, Anthropic, and Google-compatible endpoints.
- Start with API-key based auth as default.
- Define OAuth as a staged feature after parity and stability gates.

## Consequences
- Faster initial hardening and predictable secrets handling.
- OAuth-dependent deployments will require a later milestone before parity claims in those environments.
- Provider adapters should expose a common model registry contract so OAuth providers can be added without core churn.
