import { type Capability, createPolicyEngine } from "@pi-bun-effect/extensions";
import { expect, test } from "bun:test";

test("policy denies dangerous commands by default", async () => {
  const engine = createPolicyEngine();

  const denied = await engine.check(
    "ext-unknown",
    "exec:spawn",
    "rm -rf /tmp/test",
  );
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
      denyPatterns: [],
    },
  ]);
  const result = await policy.check("ext-allow", "exec:spawn", "ls");
  expect(result.allowed).toBeFalse();
});

test("policy evaluates capability allow and deny", () => {
  const policy = createPolicyEngine([
    {
      extensionId: "ext-cap",
      capabilities: ["tool:read", "tool:bash"],
      allowCommands: [],
      denyCommands: [],
      denyPatterns: [],
    },
  ]);

  expect(policy.evaluateCapability("ext-cap", "tool:read")).toBeTrue();
  expect(policy.evaluateCapability("ext-cap", "tool:write")).toBeFalse();
});

test("policy check allows command when capability and command are allowed", async () => {
  const policy = createPolicyEngine([
    {
      extensionId: "ext-bash-allow",
      capabilities: ["tool:bash"],
      allowCommands: ["echo hello"],
      denyCommands: [],
      denyPatterns: [],
    },
  ]);

  const allowed = await policy.check("ext-bash-allow", "tool:bash", "echo hello");
  const denied = await policy.check("ext-bash-allow", "tool:bash", "echo nope");

  expect(allowed.allowed).toBeTrue();
  expect(denied.allowed).toBeFalse();
  expect(denied.reason).toContain("allowlist");
});
