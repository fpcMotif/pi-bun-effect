# Test Suite — pi-bun-effect

The plan below uses two existing testing patterns as oracles:

pi-mono contracts are documented directly in docs for sessions/compaction/extensions/RPC/packages/skills/templates and in package READMEs for agent event flow.

pi_agent_rust formalizes a layered “unit + fixture conformance + integration (E2E)” strategy and provides a concrete fixture schema example for tool conformance.

Bun provides a native `bun test` runner and supports coverage from the runtime/tooling level; these become the default for CI.

## Unit tests

Core parsing and invariants:

Session JSONL v3 parser/serializer:

- header parsing
- entry ID format
- `parentId` tree integrity
- migration rules (v1→v3 behavior needs explicit expected outputs)
- “do not cut at tool results” invariants used by compaction

Tool argument validation and message conversion:

- type-safe schemas

Partial tool-call JSON assembly:

- ensure streaming `toolcall_delta` events produce exactly the same JSON object as final tool call after incremental parsing

Policy engine:

- command classification
- allow/deny enforcement
- “capability gate + mediation” sequencing
- audit record formatting

Search ranking:

- deterministic scoring math
- frecency decay function
- git status weighting

Suggested unit test vectors:

SessionEntry append ordering for branching:

- create messages A→B→C, then branch from B to D, ensure `parentId` tree has two children at B and tree traversal returns correct linearization.

Compaction cut points:

- build a session with a tool call and tool result; force compaction cut point near that area; assert cut never separates tool result.

## Conformance tests (fixture-based)

Adopt fixture-based approach with JSON fixtures describing setup/input/expected output per tool and scenario.

Tools included in conformance fixtures:

P0 tools: read/write/edit/bash.

P1 tools: grep/find/ls (recommended because existing stacks emphasize these primitives).

Fixture structure: setup file/dir operations and expected outputs, executed by the Bun+Effect harness.

RPC protocol fixtures:

- command-response correlation with `id`
- streaming behavior: send prompt then send prompt without `streamingBehavior` while streaming and assert error
- send `steer` and assert interrupt behavior after current tool completes

## Integration tests

End-to-end workflows (no real provider calls):

- use a stub provider that replays scripted `LlmEvent` streams
- validate UI/session tool loop correctness and compaction triggers

Include tests for session export pipeline if implemented.

vLLM pods manager:

- mocked SSH layer
- validate config persistence
- argument rendering
- endpoint derivation

Slack bot (optional):

- simulate Slack events
- ensure per-channel contexts and log layout behavior

## E2E tests

Binary smoke tests across OS (Linux/macOS/Windows):

- launch interactive mode in a pty harness and validate basic TUI startup and command parsing
- RPC mode E2E: spawn the binary, send JSON commands, assert event format and exit stability

## Fuzzing / property-based testing

Streaming parser fuzzing:

- randomized chunk boundaries and unicode edge cases for partial JSON tool-call assembly

Session JSONL reader fuzzing:

- random line breaks and truncated entries to ensure graceful errors and no silent corruption

## Benchmarks and profiling strategy

Benchmarks should be reproducible and scenario-based.

Minimum benchmark scenarios:

Startup p95:

- `pi --version` and interactive mode "time to first prompt"

Resume p95:

- open a session with N entries and render initial UI state

Tool latency:

- read/write/edit and grep across large files

Search p95:

- fuzzy file search on large repo targets with git status and frecency weighting

SQLite index operations:

- insert/query cost for session metadata and search indices

Profiling approach:

Scenario harnesses run under Bun with deterministic inputs and collect:

- wall-clock (p50/p95/p99)
- RSS / heap snapshots at checkpoints
- event-loop stalls (if measurable)
- per-stage spans (LLM stream parse, tool dispatch, session append, UI render)

## Test cases and scenarios index

1. JSONL v3 parser and migration invariants (v1→v2→v3 and invalid line handling).
2. Branching integrity tests (`A->B->C`, branch from `B` to `D`, tree traversal correctness).
3. Compaction boundary tests where tool call + tool result must remain contiguous.
4. Streaming tool-call parser fuzz: randomized chunking/injection for partial JSON tool-call assembly.
5. Policy engine tests for capability gate + dangerous command mediation.
6. Conformance fixtures for tools (`read`, `write`, `edit`, `bash`, plus `grep/find/ls` P1).
7. RPC fixtures: correlation `id`, steer semantics, follow-up sequencing, stream mode errors.
8. Integration harness with fake LLM adapter script for deterministic event/state assertions.
9. E2E smoke: TUI startup and RPC protocol handshake.
10. Benchmarks (startup, resume, search, tool latency, SQLite index query latencies).
11. CI matrix target tasks: lint/build/test/coverage with Bun.

## CI configuration snippet

A minimal GitHub Actions matrix:

```yaml
name: ci
on:
  push:
  pull_request:

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "latest"
      - run: bun install --frozen-lockfile
      - run: bun test --coverage
```
