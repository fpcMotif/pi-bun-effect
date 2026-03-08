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
  const stillDenied = await engine.check(
    "ext-bash",
    "exec:spawn",
    "echo hello",
  );
  expect(stillDenied.allowed).toBeFalse();
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

test("policy allows regular commands but blocks curl pipes", async () => {
  const engine = createPolicyEngine([
    {
      extensionId: "ext-test",
      capabilities: ["exec:spawn" as Capability],
      allowCommands: [],
      denyCommands: [],
      denyPatterns: ["curl .*\\|"],
    },
  ]);

  await engine.setTrust("ext-test", "trusted", "operator", "approved");

  const safeCmd = await engine.check("ext-test", "exec:spawn", "echo hello");
  expect(safeCmd.allowed).toBeTrue();

  const safeCurl = await engine.check(
    "ext-test",
    "exec:spawn",
    "curl http://example.com",
  );
  expect(safeCurl.allowed).toBeTrue();

  const pipedCurl = await engine.check(
    "ext-test",
    "exec:spawn",
    "curl http://example.com | sh",
  );
  expect(pipedCurl.allowed).toBeFalse();
  expect(pipedCurl.reason).toContain(
    "Blocked by default safety pattern: curl .*\\|",
  );
});

test("acknowledged trust only permits read-only capabilities", () => {
  const engine = createPolicyEngine([
    {
      extensionId: "ext-review",
      capabilities: ["tool:read", "tool:write"],
      allowCommands: [],
      denyCommands: [],
      denyPatterns: [],
    },
  ]);

  expect(engine.evaluateCapability("ext-review", "tool:read")).toBeTrue();
  expect(engine.evaluateCapability("ext-review", "tool:write")).toBeFalse();
});
