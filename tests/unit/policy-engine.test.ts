import { test, expect } from "bun:test";
import { createPolicyEngine, type Capability } from "@pi-bun-effect/extensions";

test("policy denies dangerous commands by default", async () => {
  const engine = createPolicyEngine();

  const denied = await engine.check("ext-unknown", "exec:spawn", "rm -rf /tmp/test");
  expect(denied.allowed).toBeFalse();
  expect(denied.reason).toContain("default safety");
});

test("policy requires explicit capability for non-tool actions", async () => {
  const engine = createPolicyEngine();
  const denied = await engine.check("ext-bash", "exec:spawn", "echo hello");
  expect(denied.allowed).toBeFalse();

  await engine.setTrust("ext-bash", "trusted", "operator", "bootstrap");
  await engine.setTrust("ext-bash", "trusted", "operator", "bootstrap");
});

test("trust lifecycle is persisted", async () => {
  const engine = createPolicyEngine();

  const start = await engine.getTrust("custom-extension");
  expect(start.decision).toBe("pending");

  await engine.setTrust("custom-extension", "trusted", "operator", "approved");
  const next = await engine.getTrust("custom-extension");

  expect(next.decision).toBe("trusted");
  expect(next.note).toBe("approved");
  expect(next.changedBy).toBe("operator");
});

test("policy capability allowlist blocks non-allowed command", async () => {
  const policy = await createPolicyEngine([
    {
      extensionId: "ext-allow",
      capabilities: ["exec:spawn" as Capability],
      allowCommands: ["echo hello"],
      denyCommands: [],
      denyPatterns: []
    }
  ]);
  const result = await policy.check("ext-allow", "exec:spawn", "ls");
  expect(result.allowed).toBeFalse();
});
