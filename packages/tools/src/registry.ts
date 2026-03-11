import type { AgentMessage } from "@pi-bun-effect/core";
import {
  allowsCapabilityForTrust,
  type Capability,
  type TrustDecision,
} from "@pi-bun-effect/extensions";
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

function stripOuterQuotes(input: string): string {
  const trimmed = input.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isPathInsideBase(resolvedPath: string, base: string): boolean {
  const normalizedBase = base.endsWith(sep) ? base : `${base}${sep}`;
  return resolvedPath === base || resolvedPath.startsWith(normalizedBase);
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

  return checkedPath;
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

function makeToolResult(
  toolName: string,
  text: string,
  options: { isError?: boolean; debug?: Record<string, unknown> } = {},
): ToolOutput {
  return {
    content: {
      type: "toolResult",
      role: "tool",
      id: randomUUID(),
      parentId: undefined,
      timestamp: new Date().toISOString(),
      toolCallId: `tool-${randomUUID()}`,
      toolName,
      isError: options.isError,
      content: [{ type: "text", text }],
    },
    debug: options.debug,
  };
}

const READ_TOOL: ToolDefinition = {
  name: "read",
  description: "Read file content",
  async run(context, invocation) {
    try {
      const path = String(invocation.input.path ?? "");
      const resolved = await resolveSafePath(path, context.sandboxRoot);
      const data = await (typeof Bun !== "undefined"
        ? Bun.file(resolved).text()
        : Promise.resolve(""));
      return makeToolResult("read", data, {
        debug: { bytes: new TextEncoder().encode(data).byteLength },
      });
    } catch (error) {
      return makeToolResult("read", String(error), { isError: true });
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
      return makeToolResult("write", `wrote=${path}`);
    } catch (error) {
      return makeToolResult("write", String(error), { isError: true });
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
      if (!find) {
        throw new Error("edit requires a non-empty find value");
      }
      const replace = String(invocation.input.replace ?? "");
      const original = typeof Bun !== "undefined"
        ? await Bun.file(resolved).text()
        : "";
      if (!original.includes(find)) {
        throw new Error("find string not present in file");
      }
      const next = original.replaceAll(find, replace);
      if (typeof Bun !== "undefined") {
        await Bun.write(resolved, next);
      }
      return makeToolResult("edit", `edited=${path}`);
    } catch (error) {
      return makeToolResult("edit", String(error), { isError: true });
    }
  },
};

const BASH_TOOL: ToolDefinition = {
  name: "bash",
  description: "Safe-mode mock command runner",
  async run(context, invocation) {
    const command = String(invocation.input.command ?? "");
    if (!command) {
      return makeToolResult("bash", "no command provided", { isError: true });
    }

    const cwd = context.sandboxRoot
      ? resolve(context.sandboxRoot)
      : process.cwd();
    let text: string;
    if (command === "pwd") {
      text = cwd;
    } else if (command.startsWith("echo ")) {
      text = stripOuterQuotes(command.slice(5));
    } else if (command.startsWith("printf ")) {
      text = stripOuterQuotes(command.slice(7));
    } else {
      text = `mock-run:${command}`;
    }

    return makeToolResult("bash", text, {
      debug: { cwd, exitCode: 0 },
    });
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
        return makeToolResult("grep", "no pattern provided", { isError: true });
      }

      if (typeof Bun === "undefined") {
        return makeToolResult("grep", `mock-grep:${pattern}:${path}`);
      }

      const proc = Bun.spawnSync(["grep", "-rn", "-F", "--", pattern, resolved]);
      const output = proc.stdout.toString();
      const stderr = proc.stderr.toString();
      return makeToolResult("grep", output || stderr || "no matches", {
        isError: proc.exitCode !== 0 && proc.exitCode !== 1,
        debug: { exitCode: proc.exitCode },
      });
    } catch (error) {
      return makeToolResult("grep", String(error), { isError: true });
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
        return makeToolResult("find", `mock-find:${pattern}:${path}`);
      }

      const proc = Bun.spawnSync([
        "find", resolved, "-name", pattern, "-maxdepth", "5",
      ]);
      const output = proc.stdout.toString();
      const stderr = proc.stderr.toString();
      return makeToolResult("find", output || stderr || "no files found", {
        isError: proc.exitCode !== 0,
        debug: { exitCode: proc.exitCode },
      });
    } catch (error) {
      return makeToolResult("find", String(error), { isError: true });
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
      return makeToolResult("ls", listing || "(empty)");
    } catch (error) {
      return makeToolResult("ls", String(error), { isError: true });
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

    if (!allowsCapabilityForTrust(context.trust, capKey)) {
      throw new Error(`trust denied: ${context.trust} cannot use ${capKey}`);
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
