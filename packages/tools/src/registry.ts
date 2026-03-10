import type { AgentMessage } from "@pi-bun-effect/core";
import type {
  Capability,
  CommandMediationResult,
  PolicyEngine,
  TrustDecision,
} from "@pi-bun-effect/extensions";
import { randomUUID } from "node:crypto";

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
}

export interface CreateToolRegistryOptions {
  policyEngine?: PolicyEngine;
}

const TOOL_CAPABILITIES: Partial<Record<string, Capability>> = {
  read: "tool:read",
  write: "tool:write",
  edit: "tool:edit",
  bash: "tool:bash",
};

const allowAllPolicyEngine: PolicyEngine = {
  evaluateCapability() {
    return true;
  },
  async check() {
    return { allowed: true };
  },
  async getTrust(extensionId: string) {
    return {
      extensionId,
      decision: "trusted",
      changedBy: "default-policy-engine",
      changedAt: new Date().toISOString(),
      note: "allow-all default behavior",
    };
  },
  async setTrust() {
    return;
  },
};

function buildToolResult(
  toolName: string,
  text: string,
  isError = false,
): AgentMessage {
  return {
    type: "toolResult",
    role: "tool",
    id: randomUUID(),
    parentId: undefined,
    timestamp: new Date().toISOString(),
    toolCallId: `tool-${randomUUID()}`,
    toolName,
    isError,
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
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
      content: buildToolResult("read", data),
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
      content: buildToolResult("write", `wrote=${path}`),
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
      content: buildToolResult("edit", `edited=${path}`),
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
        content: buildToolResult("bash", "no command provided", true),
      };
    }

    if (typeof Bun === "undefined") {
      return {
        content: buildToolResult("bash", `mock-run:${command}`),
      };
    }

    const process = Bun.spawnSync(["sh", "-c", command]);
    const output = process.stdout.toString();
    const error = process.stderr.toString();
    return {
      content: buildToolResult(
        "bash",
        output || error || `exit=${process.exitCode}`,
        process.exitCode !== 0,
      ),
      debug: {
        exitCode: process.exitCode,
      },
    };
  },
};

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  constructor(private readonly policyEngine: PolicyEngine = allowAllPolicyEngine) {}

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

    const requiredCapability = TOOL_CAPABILITIES[invocation.name];
    const trustRecord = await this.policyEngine.getTrust(context.extensionId);

    let bashMediation: CommandMediationResult | undefined;

    if (requiredCapability) {
      const capabilityAllowed = this.policyEngine.evaluateCapability(
        context.extensionId,
        requiredCapability,
      );
      if (!capabilityAllowed) {
        return {
          content: buildToolResult(
            invocation.name,
            `capability denied: ${requiredCapability}`,
            true,
          ),
          debug: {
            error: {
              code: "CAPABILITY_DENIED",
              requiredCapability,
            },
            policy: {
              requiredCapability,
              allowed: false,
              contextHasCapability: context.capabilities.has(requiredCapability),
            },
            trust: {
              decision: trustRecord.decision,
              changedAt: trustRecord.changedAt,
              changedBy: trustRecord.changedBy,
            },
          },
        };
      }

      if (invocation.name === "bash") {
        const command = String(invocation.input.command ?? "");
        const mediation = await this.policyEngine.check(
          context.extensionId,
          requiredCapability,
          command,
        );
        bashMediation = mediation;

        if (!mediation.allowed) {
          return {
            content: buildToolResult(
              invocation.name,
              mediation.reason ?? "command blocked by policy",
              true,
            ),
            debug: {
              error: {
                code: "POLICY_CHECK_DENIED",
                requiredCapability,
              },
              policy: {
                requiredCapability,
                mediation,
              },
              trust: {
                decision: trustRecord.decision,
                changedAt: trustRecord.changedAt,
                changedBy: trustRecord.changedBy,
              },
            },
          };
        }
      }
    }

    const result = await definition.run(context, invocation);
    const debug = {
      ...(result.debug ?? {}),
      policy: {
        requiredCapability,
        allowed: true,
        mediation: bashMediation,
      },
      trust: {
        decision: trustRecord.decision,
        changedAt: trustRecord.changedAt,
        changedBy: trustRecord.changedBy,
      },
    };

    return {
      ...result,
      debug,
    };
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

export function createToolRegistry(
  options: CreateToolRegistryOptions = {},
): ToolRegistry {
  const registry = new InMemoryToolRegistry(
    options.policyEngine ?? allowAllPolicyEngine,
  );
  return registry;
}

export function registerBuiltinTools(registry: ToolRegistry): void {
  builtinTools.registerReadTool(registry);
  builtinTools.registerWriteTool(registry);
  builtinTools.registerEditTool(registry);
  builtinTools.registerBashTool(registry);
}
