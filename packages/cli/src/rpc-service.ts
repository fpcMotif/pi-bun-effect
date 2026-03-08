import { type AgentSession, createAgentSession } from "@pi-bun-effect/agent";
import type { AgentMessage, QueueBehavior } from "@pi-bun-effect/core";
import { createDefaultLlmProvider, type LlmModelId } from "@pi-bun-effect/llm";
import type {
  RpcCommandName,
  RpcRequest,
  RpcResponse,
} from "@pi-bun-effect/rpc";
import { createSessionStore, type SessionStore } from "@pi-bun-effect/session";
import {
  createToolRegistry,
  registerBuiltinTools,
  type ToolRegistry,
} from "@pi-bun-effect/tools";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

interface RuntimeSession {
  id: string;
  path: string;
  agent: AgentSession;
}

interface RpcExecutionOptions {
  rootDir?: string;
  sessionStore?: SessionStore;
  toolRegistry?: ToolRegistry;
}

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(16)}-${
    Math.random().toString(16).slice(2)
  }`;
}

function ok<T>(request: RpcRequest, result: T): RpcResponse<T> {
  return {
    id: request.id,
    command: request.command,
    status: "ok",
    result,
  };
}

function errorResponse(request: RpcRequest, message: string): RpcResponse {
  return {
    id: request.id,
    command: request.command,
    status: "error",
    error: message,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function asAgentMessage(payload: unknown): AgentMessage | null {
  const message = asObject(payload).message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const candidate = message as Partial<AgentMessage>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.type !== "string"
    || typeof candidate.role !== "string"
    || !Array.isArray(candidate.content)
  ) {
    return null;
  }
  return candidate as AgentMessage;
}

export class RpcExecutionService {
  private readonly sessions = new Map<string, RuntimeSession>();
  private activeSessionId = "";
  private turn = 0;
  private autoRetry = false;
  private retryAborted = false;
  private readonly provider = createDefaultLlmProvider();
  private readonly models: LlmModelId[] = [];
  private modelIndex = 0;

  private readonly rootDir: string;
  private readonly sessionStore: SessionStore;
  private readonly toolRegistry: ToolRegistry;

  constructor(options: RpcExecutionOptions = {}) {
    this.rootDir = options.rootDir ?? join(process.cwd(), ".pi-sessions");
    this.sessionStore = options.sessionStore ?? createSessionStore();
    this.toolRegistry = options.toolRegistry ?? createToolRegistry();
    registerBuiltinTools(this.toolRegistry);
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const starter = await this.createSession(makeId("session"));
    this.activeSessionId = starter.id;
    const models = await this.provider.modelRegistry();
    if (models.length > 0) {
      this.models.push(...models);
    }
  }

  async handle(request: RpcRequest): Promise<RpcResponse> {
    try {
      const command = request.command;
      switch (command) {
        case "prompt":
          return await this.handleTurn(request, "prompt");
        case "steer":
          return await this.handleTurn(request, "steer");
        case "followUp":
        case "follow_up":
          return await this.handleTurn(request, "followUp");
        case "abort":
          return await this.handleAbort(request);
        case "get_state":
          return await this.handleGetState(request);
        case "get_messages":
          return await this.handleGetMessages(request);
        case "set_model":
          return await this.handleSetModel(request);
        case "cycle_model":
          return this.handleCycleModel(request);
        case "get_available_models":
          return this.handleAvailableModels(request);
        case "compact":
          return await this.handleCompact(request);
        case "set_auto_retry":
          return this.handleSetAutoRetry(request);
        case "abort_retry":
          return this.handleAbortRetry(request);
        case "new_session":
          return await this.handleNewSession(request);
        case "switch":
          return await this.handleSwitch(request);
        case "fork":
          return await this.handleFork(request);
        case "tree_navigation":
          return await this.handleTreeNavigation(request);
        case "bash":
          return await this.handleBash(request);
        case "set_thinking_level":
        case "cycle_thinking_level":
        case "set_steering_mode":
        case "set_follow_up_mode":
        case "set_auto_compaction":
          return ok(request, { command, accepted: true });
        default:
          return errorResponse(
            request,
            `unsupported command: ${request.command}`,
          );
      }
    } catch (error) {
      return errorResponse(
        request,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async handleTurn(
    request: RpcRequest,
    mode: "prompt" | QueueBehavior,
  ): Promise<RpcResponse> {
    const session = this.getActiveSession();
    const message = asAgentMessage(request.payload);
    if (!message) {
      return errorResponse(request, "payload.message is required");
    }

    await this.sessionStore.append(session.path, {
      type: "message",
      data: message,
      parentId: message.parentId,
    });

    const result = mode === "prompt"
      ? await session.agent.prompt({ message })
      : mode === "steer"
      ? await session.agent.steer({ message })
      : await session.agent.followUp({ message });

    this.turn += 1;
    return ok(request, {
      sessionId: session.id,
      turn: this.turn,
      mode,
      events: result.events,
      queueDepth: result.finalState.queueDepth,
    });
  }

  private async handleAbort(request: RpcRequest): Promise<RpcResponse> {
    const session = this.getActiveSession();
    await session.agent.cancelCurrentTurn();
    return ok(request, { sessionId: session.id, aborted: true });
  }

  private async handleGetState(request: RpcRequest): Promise<RpcResponse> {
    const session = this.getActiveSession();
    const state = await session.agent.getState();
    return ok(request, {
      sessionId: session.id,
      activeSessionId: this.activeSessionId,
      busy: state.isRunning,
      queued: state.queueDepth.steer + state.queueDepth.followUp,
      model: this.models[this.modelIndex] ?? null,
      autoRetry: this.autoRetry,
      retryAborted: this.retryAborted,
    });
  }

  private async handleGetMessages(request: RpcRequest): Promise<RpcResponse> {
    const session = this.getActiveSession();
    const entries = await this.sessionStore.readAll(session.path);
    return ok(request, {
      sessionId: session.id,
      messages: entries.map((entry) => entry.data),
    });
  }

  private async handleSetModel(request: RpcRequest): Promise<RpcResponse> {
    const payload = asObject(request.payload);
    const provider = payload.provider;
    const modelId = payload.modelId;
    if (typeof provider !== "string" || typeof modelId !== "string") {
      return errorResponse(
        request,
        "payload.provider and payload.modelId are required",
      );
    }

    const idx = this.models.findIndex((model) =>
      model.provider === provider && model.modelId === modelId
    );
    if (idx === -1) {
      this.models.push({
        provider: provider as LlmModelId["provider"],
        modelId,
      });
      this.modelIndex = this.models.length - 1;
    } else {
      this.modelIndex = idx;
    }
    return ok(request, { activeModel: this.models[this.modelIndex] });
  }

  private handleCycleModel(request: RpcRequest): RpcResponse {
    if (this.models.length === 0) {
      return errorResponse(request, "no models available");
    }
    this.modelIndex = (this.modelIndex + 1) % this.models.length;
    return ok(request, {
      activeModel: this.models[this.modelIndex],
      index: this.modelIndex,
    });
  }

  private handleAvailableModels(request: RpcRequest): RpcResponse {
    return ok(request, { models: this.models, activeIndex: this.modelIndex });
  }

  private async handleCompact(request: RpcRequest): Promise<RpcResponse> {
    const session = this.getActiveSession();
    await session.agent.compact();
    return ok(request, { sessionId: session.id, compacted: true });
  }

  private handleSetAutoRetry(request: RpcRequest): RpcResponse {
    const enabled = asObject(request.payload).enabled;
    this.autoRetry = typeof enabled === "boolean" ? enabled : true;
    this.retryAborted = false;
    return ok(request, { autoRetry: this.autoRetry });
  }

  private handleAbortRetry(request: RpcRequest): RpcResponse {
    this.retryAborted = true;
    return ok(request, { autoRetry: this.autoRetry, retryAborted: true });
  }

  private async handleNewSession(request: RpcRequest): Promise<RpcResponse> {
    const session = await this.createSession(makeId("session"));
    this.activeSessionId = session.id;
    return ok(request, { sessionId: session.id, active: true });
  }

  private async handleSwitch(request: RpcRequest): Promise<RpcResponse> {
    const sessionId = asObject(request.payload).sessionId;
    if (typeof sessionId !== "string") {
      return errorResponse(request, "payload.sessionId is required");
    }
    const next = this.sessions.get(sessionId);
    if (!next) {
      return errorResponse(request, `session not found: ${sessionId}`);
    }
    this.activeSessionId = next.id;
    return ok(request, { sessionId: this.activeSessionId, switched: true });
  }

  private async handleFork(request: RpcRequest): Promise<RpcResponse> {
    const session = this.getActiveSession();
    const entries = await this.sessionStore.readAll(session.path);
    const payload = asObject(request.payload);
    const requestedId = typeof payload.entryId === "string"
      ? payload.entryId
      : entries.at(-1)?.id;
    if (!requestedId) {
      return errorResponse(request, "no entries available to fork from");
    }
    const parentEntry = entries.find((entry) =>
      entry.id === requestedId || entry.data.id === requestedId
    );
    if (!parentEntry) {
      return errorResponse(request, `fork parent not found: ${requestedId}`);
    }
    const forkedId = await this.sessionStore.fork(session.path, parentEntry.id);
    return ok(request, {
      sessionId: session.id,
      parentId: parentEntry.id,
      forkedEntryId: forkedId,
    });
  }

  private async handleTreeNavigation(
    request: RpcRequest,
  ): Promise<RpcResponse> {
    const session = this.getActiveSession();
    const payload = asObject(request.payload);
    const action = payload.action;
    const entryId = payload.entryId;
    if (typeof action !== "string" || typeof entryId !== "string") {
      return errorResponse(
        request,
        "payload.action and payload.entryId are required",
      );
    }

    if (action === "parent") {
      const parent = await this.sessionStore.parent(session.path, entryId);
      return ok(request, { sessionId: session.id, action, node: parent });
    }

    if (action === "children") {
      const children = await this.sessionStore.children(session.path, entryId);
      return ok(request, { sessionId: session.id, action, nodes: children });
    }

    if (action === "linearize") {
      const chain = await this.sessionStore.linearizeFrom(
        session.path,
        entryId,
      );
      return ok(request, { sessionId: session.id, action, nodes: chain });
    }

    return errorResponse(request, `unsupported tree action: ${action}`);
  }

  private async handleBash(request: RpcRequest): Promise<RpcResponse> {
    const session = this.getActiveSession();
    const payload = asObject(request.payload);
    const command = typeof payload.command === "string"
      ? payload.command
      : typeof payload.text === "string"
      ? payload.text
      : "";

    const result = await this.toolRegistry.execute(
      {
        sessionId: session.id,
        extensionId: "rpc",
        trust: "trusted",
        capabilities: new Set(["tool:bash"]),
      },
      {
        name: "bash",
        input: { command },
      },
    );

    return ok(request, {
      sessionId: session.id,
      tool: "bash",
      output: result.content.content,
      isError: result.content.type === "toolResult"
        ? result.content.isError ?? false
        : false,
      debug: result.debug,
    });
  }

  private getActiveSession(): RuntimeSession {
    const session = this.sessions.get(this.activeSessionId);
    if (!session) {
      throw new Error("no active session");
    }
    return session;
  }

  private async createSession(sessionId: string): Promise<RuntimeSession> {
    const path = join(this.rootDir, `${sessionId}.jsonl`);
    await this.sessionStore.open(path);
    const agent = await createAgentSession({
      sessionId,
      contextWindowTokens: 32_000,
      reserveTokens: 2_000,
      autoCompaction: true,
    });

    const runtime: RuntimeSession = { id: sessionId, path, agent };
    this.sessions.set(sessionId, runtime);
    return runtime;
  }
}

export async function createRpcExecutionService(
  options: RpcExecutionOptions = {},
): Promise<RpcExecutionService> {
  const service = new RpcExecutionService(options);
  await service.initialize();
  return service;
}

export function isRpcCommandImplemented(command: RpcCommandName): boolean {
  return new Set<RpcCommandName>([
    "prompt",
    "steer",
    "followUp",
    "follow_up",
    "abort",
    "get_state",
    "get_messages",
    "set_model",
    "cycle_model",
    "get_available_models",
    "set_thinking_level",
    "cycle_thinking_level",
    "set_steering_mode",
    "set_follow_up_mode",
    "compact",
    "set_auto_compaction",
    "set_auto_retry",
    "abort_retry",
    "bash",
    "new_session",
    "switch",
    "fork",
    "tree_navigation",
  ]).has(command);
}
