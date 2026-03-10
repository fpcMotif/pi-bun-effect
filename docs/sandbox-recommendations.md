# Sandbox Recommendations

Use a sandbox profile that still allows local filesystem persistence and controlled process execution.

## Minimum capabilities

- Read/write access to project-local state directories:
  - `.pi/slack/`
  - `.pi/pods/`
  - `.pi/artifacts/`
- Permission to execute shell commands for pod lifecycle control.

## Suggested policy

- Allow outbound network only for explicitly required providers/services.
- Block writes outside the repository working directory.
- Restrict executable set where possible, but include `sh`, `python3` (if using vLLM commands), and basic process tools used by lifecycle commands.

## Risk controls

- Log each lifecycle command invocation with timestamp and caller identity.
- Use per-environment state roots (e.g., staging/prod separation) to avoid cross-environment contamination.
- Rotate and prune `.pi/artifacts/` and `.pi/slack/` to control storage growth.

## CI mode recommendation

- In CI, use temporary directories for all state roots and assert that tests do not depend on preexisting files.
