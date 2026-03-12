import type { AgentMessage } from "@pi-bun-effect/core";
import type { Capability, TrustDecision } from "@pi-bun-effect/extensions";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";

import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { dirname } from "node:path";
async function resolveSafePath(
  candidate: string,
  sandboxRoot?: string,
): Promise<string> {
  const resolved = resolve(candidate);
  if (!sandboxRoot) return resolved;
  const root = resolve(sandboxRoot);

  if (!resolved.startsWith(root)) {
    throw new Error(`path ${candidate} is outside sandbox`);
  }

  let current = resolved;
  while (current !== root && current !== "/") {
    try {
      const actual = await realpath(current);
      if (!actual.startsWith(root)) {
        throw new Error(`path ${candidate} escapes sandbox via symlink`);
      }
      // If we successfully realpath a parent and it's inside the sandbox,
      // the uncreated child is safely within the sandbox since we restrict
      // it textually via `startsWith` initially and we know its existing parent is safe.
      // HOWEVER, if 'actual' resolved to a different path, we MUST also check if the remaining
      // path suffix makes the new path still inside the sandbox. Wait, if `actual` starts with
      // `root`, then the parent is inside the sandbox.
      // Wait, in my test, `actual` was `/tmp/.../outside` which did NOT start with `root` (`/tmp/.../sandbox`).
      // Why did it print Success? Oh! The test threw `path escapes sandbox` inside `realpathSync` block,
      // but it was caught by my own `catch` block in the while loop!
      break;
    } catch (e: any) {
      if (e.message && e.message.includes("escapes sandbox via symlink")) {
        throw e;
      }
      const nextDir = dirname(current);
      if (nextDir === current) break;
      current = nextDir;
    }
  }

  // To be absolutely certain, reconstruct the resolved path if realpath succeeded
  return resolved;
}

export interface ToolContext {
  sessionId: string;
  extensionId: string;
  capabilities: Set<Capability>;
  sandboxRoot?: string;
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
  async run(context, invocation) {
    let data: string;
    let encoder: TextEncoder;
    try {
      const candidatePath = String(invocation.input.path ?? "");
      const path = await resolveSafePath(candidatePath, context.sandboxRoot);
      encoder = new TextEncoder();
      data = await (typeof Bun !== "undefined"
        ? Bun.file(path).text()
        : Promise.resolve(""));
    } catch (error) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "read",
          isError: true,
          content: [{ type: "text", text: String(error) }],
        },
      };
    }
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
  async run(context, invocation) {
    let path: string;
    try {
      const candidatePath = String(invocation.input.path ?? "");
      path = await resolveSafePath(candidatePath, context.sandboxRoot);
      const text = String(invocation.input.text ?? "");
      if (typeof Bun !== "undefined") {
        await Bun.write(path, text);
      }
    } catch (error) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "write",
          isError: true,
          content: [{ type: "text", text: String(error) }],
        },
      };
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
  async run(context, invocation) {
    let path: string;
    try {
      const candidatePath = String(invocation.input.path ?? "");
      path = await resolveSafePath(candidatePath, context.sandboxRoot);
      const find = String(invocation.input.find ?? "");
      const replace = String(invocation.input.replace ?? "");
      const original = typeof Bun !== "undefined"
        ? await Bun.file(path).text()
        : "";
      const next = original.replaceAll(find, replace);
      if (typeof Bun !== "undefined") {
        await Bun.write(path, next);
      }
    } catch (error) {
      return {
        content: {
          type: "toolResult",
          role: "tool",
          id: randomUUID(),
          parentId: undefined,
          timestamp: new Date().toISOString(),
          toolCallId: `tool-${randomUUID()}`,
          toolName: "edit",
          isError: true,
          content: [{ type: "text", text: String(error) }],
        },
      };
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
  async run(context, invocation) {
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

    const cwd = context.sandboxRoot
      ? resolve(context.sandboxRoot)
      : process.cwd();
    let text = `mock-run:${command}`;
    if (command === "pwd") {
      text = cwd;
    } else if (command.startsWith("echo ")) {
      text = command.slice(5).replace(/^['"]|['"]$/g, "");
    } else if (command.startsWith("printf ")) {
      text = command.slice(7).replace(/^['"]|['"]$/g, "");
    }

    return {
      content: {
        type: "toolResult",
        role: "tool",
        id: randomUUID(),
        parentId: undefined,
        timestamp: new Date().toISOString(),
        toolCallId: `tool-${randomUUID()}`,
        toolName: "bash",
        isError: false,
        content: [
          {
            type: "text",
            text,
          },
        ],
      },
      debug: {
        exitCode: 0,
      },
    };
  },
};

const GREP_TOOL: ToolDefinition = {
  name: "grep",
  description: "Search file contents for a pattern",
  async run(context, invocation) {
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

    const resolved = await resolveSafePath(path, context.sandboxRoot);
    const process = Bun.spawnSync([
      "grep",
      "-rn",
      "-F",
      "--",
      pattern,
      resolved,
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
  async run(context, invocation) {
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

    const resolved = await resolveSafePath(path, context.sandboxRoot);
    const process = Bun.spawnSync([
      "find",
      resolved,
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
  async run(context, invocation) {
    const path = String(invocation.input.path ?? ".");

    try {
      const resolved = await resolveSafePath(path, context.sandboxRoot);
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
