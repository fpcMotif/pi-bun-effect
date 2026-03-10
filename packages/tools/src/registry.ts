import {
  type AgentMessage,
  type AuditLogger,
  NoopAuditLogger,
  nowIso,
  redactMetadata,
} from "@pi-bun-effect/core";
import type { Capability, TrustDecision } from "@pi-bun-effect/extensions";
import { randomUUID } from "node:crypto";

export interface ToolContext {
  sessionId: string;
  requestId?: string;
  extensionId: string;
  capabilities: Set<Capability>;
  trust: TrustDecision;
}

export interface ToolInvocation {
  name: string;
  input: Record<string, unknown>;
  raw?: string;
}

export interface ToolOutput {
  content: AgentMessage;
  debug?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  run(context: ToolContext, invocation: ToolInvocation): Promise<ToolOutput>;
}

export interface ToolRegistry {
  register(definition: ToolDefinition): void;
  unregister(name: string): void;
  get(name: string): ToolDefinition | undefined;
  list(): ToolDefinition[];
  execute(
    context: ToolContext,
    invocation: ToolInvocation,
  ): Promise<ToolOutput>;
}

export interface BuiltinTools {
  registerReadTool(registry: ToolRegistry): void;
  registerWriteTool(registry: ToolRegistry): void;
  registerEditTool(registry: ToolRegistry): void;
  registerBashTool(registry: ToolRegistry): void;
}

const READ_TOOL: ToolDefinition = {
  name: "read",
  description: "Read file content",
  async run(_context, invocation) {
    const path = String(invocation.input.path ?? "");
    const encoder = new TextEncoder();
    const data = await (typeof Bun !== "undefined"
      ? Bun.file(path).text()
      : Promise.resolve(""));
    return {
      content: {
        type: "toolResult",
        role: "tool",
        id: randomUUID(),
        parentId: undefined,
        timestamp: new Date().toISOString(),
        toolCallId: `tool-${randomUUID()}`,
        toolName: "read",
        content: [
          {
            type: "text",
            text: data,
          },
        ],
      },
      debug: {
        bytes: encoder.encode(data).byteLength,
      },
    };
  },
};

const WRITE_TOOL: ToolDefinition = {
  name: "write",
  description: "Write file content",
  async run(_context, invocation) {
    const path = String(invocation.input.path ?? "");
    const text = String(invocation.input.text ?? "");
    if (typeof Bun !== "undefined") {
      await Bun.write(path, text);
    }
    return {
      content: {
        type: "toolResult",
        role: "tool",
        id: randomUUID(),
        parentId: undefined,
        timestamp: new Date().toISOString(),
        toolCallId: `tool-${randomUUID()}`,
        toolName: "write",
        isError: false,
        content: [
          {
            type: "text",
            text: `wrote=${path}`,
          },
        ],
      },
    };
  },
};

const EDIT_TOOL: ToolDefinition = {
  name: "edit",
  description: "Simple substring replace on file",
  async run(_context, invocation) {
    const path = String(invocation.input.path ?? "");
    const find = String(invocation.input.find ?? "");
    const replace = String(invocation.input.replace ?? "");
    const original = typeof Bun !== "undefined"
      ? await Bun.file(path).text()
      : "";
    const next = original.replaceAll(find, replace);
    if (typeof Bun !== "undefined") {
      await Bun.write(path, next);
    }
    return {
      content: {
        type: "toolResult",
        role: "tool",
        id: randomUUID(),
        parentId: undefined,
        timestamp: new Date().toISOString(),
        toolCallId: `tool-${randomUUID()}`,
        toolName: "edit",
        content: [
          {
            type: "text",
            text: `edited=${path}`,
          },
        ],
      },
    };
  },
};

const BASH_TOOL: ToolDefinition = {
  name: "bash",
  description: "Safe-mode mock command runner",
  async run(_context, invocation) {
    const command = String(invocation.input.command ?? "");
    if (!command) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "bash",
          isError: true,
          content: [
            {
              type: "text",
              text: "no command provided",
            },
          ],
        },
      };
    }

    if (typeof Bun === "undefined") {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "bash",
          content: [
            {
              type: "text",
              text: `mock-run:${command}`,
            },
          ],
        },
      };
    }

    const process = Bun.spawnSync(["sh", "-c", command]);
    const output = process.stdout.toString();
    const error = process.stderr.toString();
    return {
      content: {
        type: "toolResult",
        role: "tool",
        id: randomUUID(),
        parentId: undefined,
        timestamp: new Date().toISOString(),
        toolCallId: `tool-${randomUUID()}`,
        toolName: "bash",
        isError: process.exitCode !== 0,
        content: [
          {
            type: "text",
            text: output || error || `exit=${process.exitCode}`,
          },
        ],
      },
      debug: {
        exitCode: process.exitCode,
      },
    };
  },
};

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

  constructor(private readonly auditLogger: AuditLogger = new NoopAuditLogger()) {}

  register(definition: ToolDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  unregister(name: string): void {
    this.definitions.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.definitions.values());
  }

  async execute(
    context: ToolContext,
    invocation: ToolInvocation,
  ): Promise<ToolOutput> {
    const definition = this.definitions.get(invocation.name);
    if (!definition) {
      this.auditLogger.emit({
        type: "tools.registry.execute",
        at: nowIso(),
        extensionId: context.extensionId,
        capability: `tool:${invocation.name}`,
        toolName: invocation.name,
        outcome: "deny",
        reason: "tool not found",
        correlationIds: {
          sessionId: context.sessionId,
          requestId: context.requestId,
        },
        metadata: redactMetadata({
          invocationInput: invocation.input,
        }),
      });
      throw new Error(`tool not found: ${invocation.name}`);
    }

    try {
      const output = await definition.run(context, invocation);
      this.auditLogger.emit({
        type: "tools.registry.execute",
        at: nowIso(),
        extensionId: context.extensionId,
        capability: `tool:${invocation.name}`,
        toolName: invocation.name,
        command: invocation.raw,
        outcome: output.content.type === "toolResult" && output.content.isError
          ? "error"
          : "success",
        correlationIds: {
          sessionId: context.sessionId,
          requestId: context.requestId,
        },
        metadata: redactMetadata({
          invocationInput: invocation.input,
          debug: output.debug,
        }),
      });
      return output;
    } catch (error) {
      this.auditLogger.emit({
        type: "tools.registry.execute",
        at: nowIso(),
        extensionId: context.extensionId,
        capability: `tool:${invocation.name}`,
        toolName: invocation.name,
        command: invocation.raw,
        outcome: "error",
        reason: error instanceof Error ? error.message : "unknown tool failure",
        correlationIds: {
          sessionId: context.sessionId,
          requestId: context.requestId,
        },
        metadata: redactMetadata({
          invocationInput: invocation.input,
        }),
      });
      throw error;
    }
  }
}

export const builtinTools: BuiltinTools = {
  registerReadTool(registry) {
    registry.register(READ_TOOL);
  },
  registerWriteTool(registry) {
    registry.register(WRITE_TOOL);
  },
  registerEditTool(registry) {
    registry.register(EDIT_TOOL);
  },
  registerBashTool(registry) {
    registry.register(BASH_TOOL);
  },
};

export function createToolRegistry(auditLogger?: AuditLogger): ToolRegistry {
  const registry = new InMemoryToolRegistry(auditLogger);
  return registry;
}

export function registerBuiltinTools(registry: ToolRegistry): void {
  builtinTools.registerReadTool(registry);
  builtinTools.registerWriteTool(registry);
  builtinTools.registerEditTool(registry);
  builtinTools.registerBashTool(registry);
}
