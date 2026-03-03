# ADR 0004: Slack integration runtime path

## Status
- Draft

## Context
Slack SDK compatibility with Bun is an execution risk. A conservative Bun-compatible path is required for launch.

## Decision
- Use low-level Slack Web API and Socket Mode protocol implementation as the default integration path.
- Keep higher-level SDK wrappers as optional follow-up once runtime compatibility is proven.

## Consequences
- Smaller dependency surface and better control over runtime behavior.
- Higher implementation burden compared to full-framework bots.
- Slack bot remains optional for V1 and gated by operational risk assumptions.
