import {
  type AgentConfig,
  type AgentSession,
  InMemoryAgentSessionFactory,
  type AgentSessionFactory,
} from "@pi-bun-effect/agent";
import { isAgentMessage, type AgentMessage } from "@pi-bun-effect/core";
import {
  createSessionStore,
  type JsonlSessionEntry,
  type SessionStore,
} from "@pi-bun-effect/session";
import { join } from "node:path";
import type {
  RpcCommandName,
  RpcEvent,
  RpcRequest,
  RpcResponse,
  SetModelPayload,
} from "./protocol";

interface SessionRuntime {
  id: string;
  path: string;
  agent: AgentSession;
  currentEntryId?: string;
  model: SetModelPayload;
}

export interface RpcDispatcherOptions {
  rootDir?: string;
  sessionStore?: SessionStore;
  sessionFactory?: AgentSessionFactory;
  onEvent?: (event: RpcEvent) => void;
  defaultModel?: SetModelPayload;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultAgentConfig(sessionId: string): AgentConfig {
  return {
    sessionId,
    contextWindowTokens: 8192,
    reserveTokens: 512,
    autoCompaction: true,
  };
}

function toSessionPath(rootDir: string, sessionId: string): string {
  return join(rootDir, `${sessionId}.jsonl`);
}

function normalizeCommand(command: RpcCommandName): RpcCommandName {
  return command === "follow_up" ? "followUp" : command;
}

export class RpcCommandDispatcher {
  private readonly store: SessionStore;
  private readonly factory: AgentSessionFactory;
  private readonly rootDir: string;
  private readonly onEvent?: (event: RpcEvent) => void;
  private readonly sessions = new Map<string, SessionRuntime>();
  private activeSessionId = "";
  private queue = Promise.resolve();
  private readonly defaultModel: SetModelPayload;

  constructor(options: RpcDispatcherOptions = {}) {
    this.store = options.sessionStore ?? createSessionStore();
    this.factory = options.sessionFactory ?? new InMemoryAgentSessionFactory();
    this.rootDir = options.rootDir ?? ".pi-sessions";
    this.onEvent = options.onEvent;
    this.defaultModel = options.defaultModel ?? {
      provider: "openai",
      modelId: "gpt-4o-mini",
    };
  }

  async dispatch(request: RpcRequest): Promise<RpcResponse> {
    const command = normalizeCommand(request.command);

    switch (command) {
      case "prompt":
        return this.runPrompt(request, "prompt");
      case "steer":
        return this.enqueueTurn(request, "steer");
      case "followUp":
        return this.enqueueTurn(request, "followUp");
      case "get_state":
        return this.getState(request, command);
      case "get_messages":
        return this.getMessages(request, command);
      case "set_model":
        return this.setModel(request, command);
      case "compact":
        return this.compact(request, command);
      case "new_session":
        return this.newSession(request, command);
      case "switch":
        return this.switchSession(request, command);
      case "fork":
        return this.forkSession(request, command);
      case "tree_navigation":
        return this.treeNavigation(request, command);
      default:
        return {
          id: request.id,
          command: request.command,
          status: "error",
          error: `unsupported command: ${request.command}`,
        };
    }
  }

  async waitForQueue(): Promise<void> {
    await this.queue;
  }

  private async runPrompt(
    request: RpcRequest,
    mode: "prompt" | "steer" | "followUp",
  ): Promise<RpcResponse> {
    const runtime = await this.getActiveRuntime();
    const payload = request.payload as { message?: AgentMessage } | undefined;
    const message = payload?.message;
    if (!isAgentMessage(message)) {
      return {
        id: request.id,
        command: request.command,
        status: "error",
        error: "payload.message must be an AgentMessage",
      };
    }

    const entry = await this.store.append(runtime.path, {
      type: message.type,
      parentId: runtime.currentEntryId,
      data: message,
    });
    runtime.currentEntryId = entry.id;

    const turnResult = mode === "prompt"
      ? await runtime.agent.prompt({ message })
      : mode === "steer"
      ? await runtime.agent.steer({ message })
      : await runtime.agent.followUp({ message });

    for (const event of turnResult.events) {
      this.onEvent?.({
        type: "agent_event",
        id: request.id,
        command: request.command,
        payload: event,
      });
    }

    return {
      id: request.id,
      command: request.command,
      status: "ok",
      result: {
        sessionId: runtime.id,
        currentEntryId: runtime.currentEntryId,
        state: turnResult.finalState,
      },
    };
  }

  private async enqueueTurn(
    request: RpcRequest,
    mode: "steer" | "followUp",
  ): Promise<RpcResponse> {
    this.queue = this.queue.then(async () => {
      await this.runPrompt(request, mode);
    });

    return {
      id: request.id,
      command: request.command,
      status: "ok",
      result: {
        queued: true,
      },
    };
  }

  private async getState(
    request: RpcRequest,
    command: RpcCommandName,
  ): Promise<RpcResponse> {
    const runtime = await this.getActiveRuntime();
    const state = await runtime.agent.getState();
    return {
      id: request.id,
      command,
      status: "ok",
      result: {
        ...state,
        model: runtime.model,
        currentEntryId: runtime.currentEntryId,
      },
    };
  }

  private async getMessages(
    request: RpcRequest,
    command: RpcCommandName,
  ): Promise<RpcResponse> {
    const runtime = await this.getActiveRuntime();
    const entries = await this.store.readAll(runtime.path);
    return {
      id: request.id,
      command,
      status: "ok",
      result: {
        sessionId: runtime.id,
        messages: entries,
      },
    };
  }

  private async setModel(
    request: RpcRequest,
    command: RpcCommandName,
  ): Promise<RpcResponse> {
    const payload = request.payload as Partial<SetModelPayload> | undefined;
    if (typeof payload?.provider !== "string" || typeof payload.modelId !== "string") {
      return {
        id: request.id,
        command,
        status: "error",
        error: "payload.provider and payload.modelId are required",
      };
    }

    const runtime = await this.getActiveRuntime();
    runtime.model = {
      provider: payload.provider,
      modelId: payload.modelId,
    };
    return {
      id: request.id,
      command,
      status: "ok",
      result: {
        sessionId: runtime.id,
        model: runtime.model,
      },
    };
  }

  private async compact(
    request: RpcRequest,
    command: RpcCommandName,
  ): Promise<RpcResponse> {
    const runtime = await this.getActiveRuntime();
    await runtime.agent.compact();
    const entry = await this.store.append(runtime.path, {
      type: "compactionSummary",
      parentId: runtime.currentEntryId,
      data: {
        type: "compactionSummary",
        role: "system",
        id: makeId(),
        timestamp: new Date().toISOString(),
        content: [{ type: "text", text: "Compaction requested via RPC." }],
      },
    });
    runtime.currentEntryId = entry.id;

    return {
      id: request.id,
      command,
      status: "ok",
      result: {
        sessionId: runtime.id,
        compacted: true,
      },
    };
  }

  private async newSession(
    request: RpcRequest,
    command: RpcCommandName,
  ): Promise<RpcResponse> {
    const sessionId = makeId();
    const runtime = await this.createRuntime(sessionId);
    this.activeSessionId = runtime.id;
    return {
      id: request.id,
      command,
      status: "ok",
      result: { sessionId: runtime.id },
    };
  }

  private async switchSession(
    request: RpcRequest,
    command: RpcCommandName,
  ): Promise<RpcResponse> {
    const payload = request.payload as { sessionId?: string } | undefined;
    if (!payload?.sessionId) {
      return { id: request.id, command, status: "error", error: "payload.sessionId is required" };
    }

    if (!this.sessions.has(payload.sessionId)) {
      await this.createRuntime(payload.sessionId);
    }
    this.activeSessionId = payload.sessionId;

    return {
      id: request.id,
      command,
      status: "ok",
      result: { sessionId: this.activeSessionId },
    };
  }

  private async forkSession(
    request: RpcRequest,
    command: RpcCommandName,
  ): Promise<RpcResponse> {
    const runtime = await this.getActiveRuntime();
    const payload = request.payload as { entryId?: string } | undefined;
    const entryId = payload?.entryId ?? runtime.currentEntryId;
    if (!entryId) {
      return { id: request.id, command, status: "error", error: "entryId is required" };
    }

    try {
      const forkedId = await this.store.fork(runtime.path, entryId);
      runtime.currentEntryId = forkedId;
      return {
        id: request.id,
        command,
        status: "ok",
        result: {
          sessionId: runtime.id,
          entryId: forkedId,
        },
      };
    } catch (error) {
      return {
        id: request.id,
        command,
        status: "error",
        error: error instanceof Error ? error.message : "fork failed",
      };
    }
  }

  private async treeNavigation(
    request: RpcRequest,
    command: RpcCommandName,
  ): Promise<RpcResponse> {
    const runtime = await this.getActiveRuntime();
    const payload = request.payload as { action?: string; entryId?: string } | undefined;
    if (!payload?.action || !payload.entryId) {
      return { id: request.id, command, status: "error", error: "payload.action and payload.entryId are required" };
    }

    const action = payload.action;
    if (action === "parent") {
      const entry = await this.store.parent(runtime.path, payload.entryId);
      return this.treeResponse(request, command, entry);
    }
    if (action === "children") {
      const entries = await this.store.children(runtime.path, payload.entryId);
      return {
        id: request.id,
        command,
        status: "ok",
        result: { sessionId: runtime.id, entries },
      };
    }
    if (action === "linearize") {
      const entries = await this.store.linearizeFrom(runtime.path, payload.entryId);
      return {
        id: request.id,
        command,
        status: "ok",
        result: { sessionId: runtime.id, entries },
      };
    }

    return { id: request.id, command, status: "error", error: `unsupported tree_navigation action: ${action}` };
  }

  private treeResponse(
    request: RpcRequest,
    command: RpcCommandName,
    entry: JsonlSessionEntry | null,
  ): RpcResponse {
    return {
      id: request.id,
      command,
      status: "ok",
      result: {
        entry,
      },
    };
  }

  private async getActiveRuntime(): Promise<SessionRuntime> {
    if (!this.activeSessionId) {
      const runtime = await this.createRuntime(makeId());
      this.activeSessionId = runtime.id;
      return runtime;
    }

    const runtime = this.sessions.get(this.activeSessionId);
    if (!runtime) {
      return this.createRuntime(this.activeSessionId);
    }

    return runtime;
  }

  private async createRuntime(sessionId: string): Promise<SessionRuntime> {
    const path = toSessionPath(this.rootDir, sessionId);
    await this.store.open(path);
    const entries = await this.store.readAll(path);
    const agent = await this.factory.start(defaultAgentConfig(sessionId));
    const runtime: SessionRuntime = {
      id: sessionId,
      path,
      agent,
      currentEntryId: entries.at(-1)?.id,
      model: { ...this.defaultModel },
    };
    this.sessions.set(sessionId, runtime);
    return runtime;
  }
}

export function createRpcCommandDispatcher(options: RpcDispatcherOptions = {}): RpcCommandDispatcher {
  return new RpcCommandDispatcher(options);
}
