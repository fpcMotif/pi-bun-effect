import type { Capability } from "../../extensions/src/policy";
import { createPolicyEngine } from "../../extensions/src/policy";
import type { ToolContext, ToolDefinition } from "./registry";
import { InMemoryAuditSink } from "./audit";
import { createToolRegistry } from "./registry";
import { expect, test } from "bun:test";

const baseContext: ToolContext = {
  sessionId: "sess-1",
  extensionId: "ext-tools",
  capabilities: new Set<Capability>(["tool:bash", "tool:read"]),
  trust: "trusted",
};

test("denied command is blocked before tool execution", async () => {
  let ran = false;
  const bashTool: ToolDefinition = {
    name: "bash",
    description: "test bash tool",
    async run() {
      ran = true;
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: "tool-1",
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: "tool-call-1",
          toolName: "bash",
          content: [{ type: "text", text: "ran" }],
        },
      };
    },
  };

  const policy = createPolicyEngine([
    {
      extensionId: "ext-tools",
      capabilities: ["tool:bash"],
      allowCommands: [],
      denyCommands: ["echo"],
      denyPatterns: [],
    },
  ]);

  const audit = new InMemoryAuditSink();
  const registry = createToolRegistry({ policyEngine: policy, auditSink: audit });
  registry.register(bashTool);

  await expect(
    registry.execute(baseContext, {
      name: "bash",
      input: { command: "echo hello" },
    }),
  ).rejects.toThrow("tool execution denied");

  expect(ran).toBeFalse();
  const events = audit.list();
  expect(events).toHaveLength(1);
  expect(events[0]?.decision).toBe("deny");
  expect(events[0]?.toolName).toBe("bash");
});

test("audit sink emits records for allow and deny paths", async () => {
  const bashTool: ToolDefinition = {
    name: "bash",
    description: "test bash tool",
    async run() {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: "tool-2",
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: "tool-call-2",
          toolName: "bash",
          content: [{ type: "text", text: "ok" }],
        },
      };
    },
  };

  const audit = new InMemoryAuditSink();
  const seen: string[] = [];
  audit.onEvent((event) => seen.push(`${event.decision}:${event.command}`));

  const registry = createToolRegistry({ auditSink: audit });
  registry.register(bashTool);

  await registry.execute(baseContext, {
    name: "bash",
    input: { command: "echo ok" },
  });

  const deniedContext: ToolContext = {
    ...baseContext,
    capabilities: new Set<Capability>(["tool:read"]),
  };

  await expect(
    registry.execute(deniedContext, {
      name: "bash",
      input: { command: "echo blocked" },
    }),
  ).rejects.toThrow();

  const events = audit.list();
  expect(events).toHaveLength(2);
  expect(events[0]?.decision).toBe("allow");
  expect(events[1]?.decision).toBe("deny");
  expect(seen).toEqual(["allow:echo ok", "deny:echo blocked"]);
});
