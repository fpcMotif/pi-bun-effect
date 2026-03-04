import type { AgentMessage } from "@pi-bun-effect/core";
import type { Capability, TrustDecision } from "@pi-bun-effect/extensions";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface ToolContext {
  sessionId: string;
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
  registerGrepTool(registry: ToolRegistry): void;
  registerFindTool(registry: ToolRegistry): void;
  registerLsTool(registry: ToolRegistry): void;
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

const GREP_TOOL: ToolDefinition = {
  name: "grep",
  description: "Search file contents for a pattern",
  async run(_context, invocation) {
    const pattern = String(invocation.input.pattern ?? "");
    const path = String(invocation.input.path ?? ".");
    if (!pattern) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "grep",
          isError: true,
          content: [{ type: "text", text: "no pattern provided" }],
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
          toolName: "grep",
          content: [{ type: "text", text: `mock-grep:${pattern}:${path}` }],
        },
      };
    }

    const process = Bun.spawnSync(["grep", "-rn", pattern, path]);
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
        toolName: "grep",
        isError: process.exitCode !== 0 && process.exitCode !== 1,
        content: [{ type: "text", text: output || error || "no matches" }],
      },
      debug: { exitCode: process.exitCode },
    };
  },
};

const FIND_TOOL: ToolDefinition = {
  name: "find",
  description: "Find files by name pattern",
  async run(_context, invocation) {
    const pattern = String(invocation.input.pattern ?? "*");
    const path = String(invocation.input.path ?? ".");

    if (typeof Bun === "undefined") {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "find",
          content: [{ type: "text", text: `mock-find:${pattern}:${path}` }],
        },
      };
    }

    const process = Bun.spawnSync([
      "find",
      path,
      "-name",
      pattern,
      "-maxdepth",
      "5",
    ]);
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
        toolName: "find",
        isError: process.exitCode !== 0,
        content: [{ type: "text", text: output || error || "no files found" }],
      },
      debug: { exitCode: process.exitCode },
    };
  },
};

const LS_TOOL: ToolDefinition = {
  name: "ls",
  description: "List directory contents",
  async run(_context, invocation) {
    const path = String(invocation.input.path ?? ".");

    try {
      const resolved = resolve(path);
      const items = await readdir(resolved, { withFileTypes: true });
      const listing = items
        .map((item) => `${item.isDirectory() ? "d" : "-"} ${item.name}`)
        .join("\n");
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "ls",
          content: [{ type: "text", text: listing || "(empty)" }],
        },
      };
    } catch (error) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "ls",
          isError: true,
          content: [{ type: "text", text: String(error) }],
        },
      };
    }
  },
};

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();

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
      throw new Error(`tool not found: ${invocation.name}`);
    }

    const capKey = `tool:${invocation.name}` as Capability;
    if (!context.capabilities.has(capKey)) {
      throw new Error(`capability denied: ${capKey}`);
    }

    return definition.run(context, invocation);
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
  registerGrepTool(registry) {
    registry.register(GREP_TOOL);
  },
  registerFindTool(registry) {
    registry.register(FIND_TOOL);
  },
  registerLsTool(registry) {
    registry.register(LS_TOOL);
  },
};

export function createToolRegistry(): ToolRegistry {
  const registry = new InMemoryToolRegistry();
  return registry;
}

export function registerBuiltinTools(registry: ToolRegistry): void {
  builtinTools.registerReadTool(registry);
  builtinTools.registerWriteTool(registry);
  builtinTools.registerEditTool(registry);
  builtinTools.registerBashTool(registry);
  builtinTools.registerGrepTool(registry);
  builtinTools.registerFindTool(registry);
  builtinTools.registerLsTool(registry);
}
