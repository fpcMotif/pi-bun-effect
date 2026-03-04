import { expect, test } from "bun:test";
import { type Capability, createPolicyEngine } from "./policy";

test("denyCommands blocks base command name", async () => {
  const engine = createPolicyEngine([
    {
      extensionId: "test-ext",
      capabilities: ["exec:spawn" as Capability],
      allowCommands: [],
      denyCommands: ["mydeny"],
      denyPatterns: [],
    },
  ]);

  await engine.setTrust("test-ext", "trusted", "operator");

  const result = await engine.check("test-ext", "exec:spawn", "mydeny arg1");
  expect(result.allowed).toBeFalse();
  expect(result.reason).toBe("Command denied by denylist");
});

test("denyCommands blocks full command string", async () => {
  const engine = createPolicyEngine([
    {
      extensionId: "test-ext",
      capabilities: ["exec:spawn" as Capability],
      allowCommands: [],
      denyCommands: ["mydenyfull arg1"],
      denyPatterns: [],
    },
  ]);

  await engine.setTrust("test-ext", "trusted", "operator");

  const result = await engine.check("test-ext", "exec:spawn", "mydenyfull arg1");
  expect(result.allowed).toBeFalse();
  expect(result.reason).toBe("Command denied by denylist");
});

test("denyPatterns are isolated per extension", async () => {
    const engine = createPolicyEngine([
      {
        extensionId: "ext-a",
        capabilities: ["exec:spawn" as Capability],
        allowCommands: [],
        denyCommands: [],
        denyPatterns: ["forbidden-a"],
      },
      {
        extensionId: "ext-b",
        capabilities: ["exec:spawn" as Capability],
        allowCommands: [],
        denyCommands: [],
        denyPatterns: ["forbidden-b"],
      },
    ]);

    await engine.setTrust("ext-a", "trusted", "operator");
    await engine.setTrust("ext-b", "trusted", "operator");

    // ext-a should be blocked by its own pattern
    const resultA = await engine.check("ext-a", "exec:spawn", "echo forbidden-a");
    expect(resultA.allowed).toBeFalse();
    expect(resultA.reason).toContain("Blocked by extension safety pattern: forbidden-a");

    // ext-a should NOT be blocked by ext-b's pattern
    const resultA2 = await engine.check("ext-a", "exec:spawn", "echo forbidden-b");
    expect(resultA2.allowed).toBeTrue();

    // ext-b should be blocked by its own pattern
    const resultB = await engine.check("ext-b", "exec:spawn", "echo forbidden-b");
    expect(resultB.allowed).toBeFalse();
    expect(resultB.reason).toContain("Blocked by extension safety pattern: forbidden-b");

    // ext-b should NOT be blocked by ext-a's pattern
    const resultB2 = await engine.check("ext-b", "exec:spawn", "echo forbidden-a");
    expect(resultB2.allowed).toBeTrue();
});

test("default denyPatterns still apply to all", async () => {
    const engine = createPolicyEngine();
    const result = await engine.check("any-ext", "exec:spawn", "rm -rf /");
    expect(result.allowed).toBeFalse();
    expect(result.reason).toContain("Blocked by default safety pattern");
});
