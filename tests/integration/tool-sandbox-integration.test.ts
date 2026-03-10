import { createPolicyEngine, type Capability } from "@pi-bun-effect/extensions";
import {
  createToolRegistry,
  registerBuiltinTools,
  type ToolContext,
} from "@pi-bun-effect/tools";
import { expect, test } from "bun:test";

test("integration: bash is denied by default when trust or capability is insufficient", async () => {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);

  const context: ToolContext = {
    sessionId: "s-1",
    extensionId: "ext-denied",
    capabilities: new Set<Capability>(["tool:bash"]),
    trust: "acknowledged",
  };

  const result = await registry.execute(context, {
    name: "bash",
    input: { command: "echo denied" },
  });

  expect(result.content.isError).toBeTrue();
  expect(result.content.content.at(0)?.text).toContain("exec:spawn capability missing");
});

test("integration: bash uses selected sandbox backend", async () => {
  const registry = createToolRegistry();
  registerBuiltinTools(registry, {
    sandboxMode: "subprocess-isolated",
    policyEngine: createPolicyEngine([
      {
        extensionId: "ext-sandbox",
        capabilities: ["exec:spawn" as Capability],
        allowCommands: ["printf sandbox-ok"],
        denyCommands: [],
        denyPatterns: [],
      },
    ]),
  });

  const context: ToolContext = {
    sessionId: "s-2",
    extensionId: "ext-sandbox",
    capabilities: new Set<Capability>(["tool:bash", "exec:spawn"]),
    trust: "trusted",
  };

  const result = await registry.execute(context, {
    name: "bash",
    input: { command: "printf sandbox-ok" },
  });

  expect(result.content.isError).toBeFalse();
  expect(result.content.content.at(0)?.text).toContain("sandbox-ok");
  expect(result.debug?.sandboxMode).toBe("subprocess-isolated");
});
