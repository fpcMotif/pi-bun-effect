import type { AgentMessage } from "@pi-bun-effect/core";
import type { Capability, TrustDecision } from "@pi-bun-effect/extensions";
import { randomUUID } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";

export interface ToolContext {
  sessionId: string;
  extensionId: string;
  capabilities: Set<Capability>;
  trust: TrustDecision;
  sandboxRoot?: string;
}

function isPathInsideBase(resolvedPath: string, base: string): boolean {
  return resolvedPath === base || resolvedPath.startsWith(`${base}${sep}`);
}

export async function resolveSafePath(
  requestedPath: string,
  root?: string,
): Promise<string> {
  const base = await realpath(root ? resolve(root) : process.cwd());
  const candidate = resolve(base, requestedPath);

  let checkedPath: string;
  try {
    checkedPath = await realpath(candidate);
  } catch (error) {
    const isMissingPath = typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT";
    if (!isMissingPath) {
      throw error;
    }

    const parentPath = await realpath(dirname(candidate));
    checkedPath = resolve(parentPath, basename(candidate));
  }

  if (!isPathInsideBase(checkedPath, base)) {
    throw new Error(`Path traversal detected: ${requestedPath}`);
  }

  return candidate;
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
    try {
      const path = String(invocation.input.path ?? "");
      const resolved = await resolveSafePath(path, context.sandboxRoot);
      const encoder = new TextEncoder();
      const data = await (typeof Bun !== "undefined"
        ? Bun.file(resolved).text()
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
  },
};

const WRITE_TOOL: ToolDefinition = {
  name: "write",
  description: "Write file content",
  async run(context, invocation) {
    try {
      const path = String(invocation.input.path ?? "");
      const resolved = await resolveSafePath(path, context.sandboxRoot);
      const text = String(invocation.input.text ?? "");
      if (typeof Bun !== "undefined") {
        await Bun.write(resolved, text);
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
  },
};

const EDIT_TOOL: ToolDefinition = {
  name: "edit",
  description: "Simple substring replace on file",
  async run(context, invocation) {
    try {
      const path = String(invocation.input.path ?? "");
      const resolved = await resolveSafePath(path, context.sandboxRoot);
      const find = String(invocation.input.find ?? "");
      const replace = String(invocation.input.replace ?? "");
      const original = typeof Bun !== "undefined"
        ? await Bun.file(resolved).text()
        : "";
      const next = original.replaceAll(find, replace);
      if (typeof Bun !== "undefined") {
        await Bun.write(resolved, next);
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
        cwd,
        exitCode: 0,
      },
    };
  },
};

const GREP_TOOL: ToolDefinition = {
  name: "grep",
  description: "Search file contents for a pattern",
  async run(context, invocation) {
    try {
      const pattern = String(invocation.input.pattern ?? "");
      const path = String(invocation.input.path ?? ".");
      const resolved = await resolveSafePath(path, context.sandboxRoot);
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
            content: [{
              type: "text",
              text: `mock-grep:${pattern}:${resolved}`,
            }],
          },
        };
      }

      const process = Bun.spawnSync(["grep", "-rn", pattern, resolved]);
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
    } catch (error) {
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
          content: [{ type: "text", text: String(error) }],
        },
      };
    }
  },
};

const FIND_TOOL: ToolDefinition = {
  name: "find",
  description: "Find files by name pattern",
  async run(context, invocation) {
    try {
      const pattern = String(invocation.input.pattern ?? "*");
      const path = String(invocation.input.path ?? ".");
      const resolved = await resolveSafePath(path, context.sandboxRoot);

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
            content: [{
              type: "text",
              text: `mock-find:${pattern}:${resolved}`,
            }],
          },
        };
      }

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
          content: [{
            type: "text",
            text: output || error || "no files found",
          }],
        },
        debug: { exitCode: process.exitCode },
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
          toolName: "find",
          isError: true,
          content: [{ type: "text", text: String(error) }],
        },
      };
    }
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
