import type { Capability } from "./policy";

export interface ExtensionContext {
  extensionId: string;
  sessionId: string;
  capabilities: Set<Capability>;
}

export interface RuntimeEvent {
  type: string;
  payload?: unknown;
  timestamp: string;
}

export interface ToolRegistration {
  name: string;
  description: string;
  run(context: ExtensionContext, input: unknown): Promise<unknown>;
}

export interface CommandRegistration {
  name: string;
  description?: string;
  execute(context: ExtensionContext, args: string[]): Promise<unknown>;
}

export interface HookRegistration {
  event: string;
  handler(event: RuntimeEvent, context: ExtensionContext): Promise<void>;
}

export type PromptCallback = (
  prompt: string,
  metadata?: Record<string, unknown>,
) => Promise<string>;

export interface RuntimeServices {
  registerTool(tool: ToolRegistration): void;
  registerCommand(command: CommandRegistration): void;
  registerHook(hook: HookRegistration): void;
  setPromptCallback(callback: PromptCallback): void;
  dispatchEvent(event: RuntimeEvent, context: ExtensionContext): Promise<void>;
  executeCommand(
    name: string,
    context: ExtensionContext,
    args: string[],
  ): Promise<unknown>;
  requestPrompt(prompt: string, metadata?: Record<string, unknown>): Promise<string>;
  listTools(): string[];
  listCommands(): string[];
}

const defaultPrompt: PromptCallback = async (prompt) => prompt;

export class ExtensionRuntimeServices implements RuntimeServices {
  private readonly tools = new Map<string, ToolRegistration>();
  private readonly commands = new Map<string, CommandRegistration>();
  private readonly hooks = new Map<string, HookRegistration[]>();
  private promptCallback: PromptCallback = defaultPrompt;

  registerTool(tool: ToolRegistration): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  registerCommand(command: CommandRegistration): void {
    if (this.commands.has(command.name)) {
      throw new Error(`command already registered: ${command.name}`);
    }
    this.commands.set(command.name, command);
  }

  registerHook(hook: HookRegistration): void {
    const handlers = this.hooks.get(hook.event) ?? [];
    handlers.push(hook);
    this.hooks.set(hook.event, handlers);
  }

  setPromptCallback(callback: PromptCallback): void {
    this.promptCallback = callback;
  }

  async dispatchEvent(event: RuntimeEvent, context: ExtensionContext): Promise<void> {
    const handlers = this.hooks.get(event.type) ?? [];
    for (const hook of handlers) {
      await hook.handler(event, context);
    }
  }

  async executeCommand(
    name: string,
    context: ExtensionContext,
    args: string[],
  ): Promise<unknown> {
    const command = this.commands.get(name);
    if (!command) {
      throw new Error(`command not found: ${name}`);
    }
    return command.execute(context, args);
  }

  async requestPrompt(
    prompt: string,
    metadata: Record<string, unknown> = {},
  ): Promise<string> {
    return this.promptCallback(prompt, metadata);
  }

  listTools(): string[] {
    return [...this.tools.keys()].sort();
  }

  listCommands(): string[] {
    return [...this.commands.keys()].sort();
  }
}

export function createRuntimeServices(): RuntimeServices {
  return new ExtensionRuntimeServices();
}
