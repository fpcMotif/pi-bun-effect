import { InMemoryAuditLogger } from "../../packages/core/src/index";
import { type Capability, createPolicyEngine } from "../../packages/extensions/src/index";
import { createToolRegistry } from "../../packages/tools/src/index";
import { expect, test } from "bun:test";

test("policy emits deny and allow audit events with correlation ids", async () => {
  const audit = new InMemoryAuditLogger();
  const policy = createPolicyEngine([
    {
      extensionId: "ext-audit",
      capabilities: ["exec:spawn" as Capability],
      allowCommands: ["echo hello"],
      denyCommands: ["cat"],
      denyPatterns: [],
    },
  ], audit);

  const denied = await policy.check("ext-audit", "exec:spawn", "cat /etc/hosts", {
    correlationIds: {
      sessionId: "session-1",
      requestId: "request-deny",
    },
    metadata: {
      authorization: "Bearer abc",
      commandSource: "tests",
    },
  });
  expect(denied.allowed).toBeFalse();

  const allowed = await policy.check("ext-audit", "exec:spawn", "echo hello", {
    correlationIds: {
      sessionId: "session-1",
      requestId: "request-allow",
    },
    metadata: {
      token: "secret-token",
      commandSource: "tests",
    },
  });
  expect(allowed.allowed).toBeTrue();

  expect(audit.events).toHaveLength(2);
  expect(audit.events[0]?.outcome).toBe("deny");
  expect(audit.events[1]?.outcome).toBe("allow");
  expect(audit.events[0]?.correlationIds.requestId).toBe("request-deny");
  expect(audit.events[1]?.correlationIds.requestId).toBe("request-allow");
  expect(audit.events[0]?.metadata?.authorization).toBe("[REDACTED]");
  expect(audit.events[1]?.metadata?.token).toBe("[REDACTED]");
});

test("tool registry emits success and deny audit events", async () => {
  const audit = new InMemoryAuditLogger();
  const registry = createToolRegistry(audit);

  registry.register({
    name: "echo",
    description: "echoes",
    async run(_context, invocation) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: "tool-result-1",
          timestamp: new Date().toISOString(),
          toolCallId: "call-1",
          toolName: "echo",
          content: [{ type: "text", text: String(invocation.input.text ?? "") }],
        },
      };
    },
  });

  await registry.execute(
    {
      sessionId: "session-tool",
      requestId: "request-tool-success",
      extensionId: "ext-tool",
      capabilities: new Set(["tool:read"]),
      trust: "trusted",
    },
    {
      name: "echo",
      input: { text: "hello", password: "secret" },
    },
  );

  await expect(
    registry.execute(
      {
        sessionId: "session-tool",
        requestId: "request-tool-deny",
        extensionId: "ext-tool",
        capabilities: new Set(["tool:read"]),
        trust: "trusted",
      },
      {
        name: "missing",
        input: { token: "x" },
      },
    ),
  ).rejects.toThrow("tool not found");

  expect(audit.events).toHaveLength(2);
  expect(audit.events[0]?.outcome).toBe("success");
  expect(audit.events[0]?.correlationIds.requestId).toBe("request-tool-success");
  expect((audit.events[0]?.metadata?.invocationInput as Record<string, unknown>).password)
    .toBe("[REDACTED]");

  expect(audit.events[1]?.outcome).toBe("deny");
  expect(audit.events[1]?.correlationIds.requestId).toBe("request-tool-deny");
  expect((audit.events[1]?.metadata?.invocationInput as Record<string, unknown>).token)
    .toBe("[REDACTED]");
});
