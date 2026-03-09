import type {
  AgentEvent,
  AgentMessage,
  QueueRequest,
  ToolCallEvent,
} from "@pi-bun-effect/core";
import {
  createDefaultLlmProvider,
  type LlmEvent,
  type LlmModelId,
  type LlmProvider,
} from "@pi-bun-effect/llm";
import {
  createToolRegistry,
  registerBuiltinTools,
  type ToolContext,
  type ToolInvocation,
  type ToolRegistry,
} from "@pi-bun-effect/tools";

export interface AgentConfig {
  sessionId: string;
  contextWindowTokens: number;
  reserveTokens: number;
  autoCompaction: boolean;
}

export interface AgentState {
  sessionId: string;
  currentTurnId: string;
  isRunning: boolean;
  queueDepth: {
    steer: number;
    followUp: number;
  };
}

export interface TurnInput {
  message: AgentMessage;
}

export interface TurnResult {
  events: AgentEvent[];
  finalState: AgentState;
}

export interface AgentSession {
  prompt(input: TurnInput): Promise<TurnResult>;
  steer(input: TurnInput): Promise<TurnResult>;
  followUp(input: TurnInput): Promise<TurnResult>;
  requestQueue(request: QueueRequest): Promise<void>;
  cancelCurrentTurn(): Promise<void>;
  compact(): Promise<void>;
  getState(): Promise<AgentState>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
}

export interface AgentSessionFactory {
  start(config: AgentConfig): Promise<AgentSession>;
  stop(sessionId: string): Promise<void>;
}

type Listener = (event: AgentEvent) => void;

type TurnMode = "prompt" | "steer" | "followUp";

interface QueuedTurn {
  mode: TurnMode;
  input: TurnInput;
  resolve: (value: TurnResult | PromiseLike<TurnResult>) => void;
  reject: (reason?: unknown) => void;
}

export interface InMemoryAgentSessionDeps {
  llmProvider?: LlmProvider;
  toolRegistry?: ToolRegistry;
  model?: LlmModelId;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseToolInvocation(payload?: string): ToolInvocation | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Partial<ToolInvocation>;
    if (!parsed.name || typeof parsed.name !== "string") {
      return null;
    }
    return {
      name: parsed.name,
      input: typeof parsed.input === "object" && parsed.input ? parsed.input : {},
      raw: payload,
    };
  } catch {
    return null;
  }
}

export class InMemoryAgentSession implements AgentSession {
  private state: AgentState;
  private readonly listeners = new Set<Listener>();
  private running = false;
  private queueDepth = { steer: 0, followUp: 0 };
  private readonly steerQueue: QueuedTurn[] = [];
  private readonly followUpQueue: QueuedTurn[] = [];
  private readonly messages: AgentMessage[] = [];
  private pumpPromise: Promise<void> | null = null;
  private currentAbort: AbortController | null = null;
  private compactionRuns = 0;

  private readonly llmProvider: LlmProvider;
  private readonly toolRegistry: ToolRegistry;
  private readonly model: LlmModelId;

  constructor(
    private readonly config: AgentConfig,
    deps: InMemoryAgentSessionDeps = {},
  ) {
    this.state = {
      sessionId: config.sessionId,
      currentTurnId: makeId(),
      isRunning: false,
      queueDepth: {
        steer: 0,
        followUp: 0,
      },
    };
    this.llmProvider = deps.llmProvider ?? createDefaultLlmProvider();
    this.toolRegistry = deps.toolRegistry ?? createToolRegistry();
    if (!deps.toolRegistry) {
      registerBuiltinTools(this.toolRegistry);
    }
    this.model = deps.model ?? { provider: "openai", modelId: "gpt-4o-mini" };
  }

  async prompt(input: TurnInput): Promise<TurnResult> {
    return this.executeImmediately("prompt", input);
  }

  async steer(input: TurnInput): Promise<TurnResult> {
    return this.enqueueTurn("steer", input);
  }

  async followUp(input: TurnInput): Promise<TurnResult> {
    return this.enqueueTurn("followUp", input);
  }

  async requestQueue(request: QueueRequest): Promise<void> {
    const message: AgentMessage = {
      type: "user",
      role: "user",
      id: request.content,
      timestamp: nowIso(),
      content: [{ type: "text", text: request.content }],
    };

    await this.enqueueTurn(request.queue, { message }).then(() => undefined);
  }

  async cancelCurrentTurn(): Promise<void> {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    this.steerQueue.length = 0;
    this.followUpQueue.length = 0;
    this.queueDepth = { steer: 0, followUp: 0 };
    this.syncState();

    if (this.running) {
      this.emit({
        type: "abort",
        sessionId: this.state.sessionId,
        turnId: this.state.currentTurnId,
        at: nowIso(),
      });
    }
  }

  async compact(): Promise<void> {
    const cut = this.findCompactionCutPoint();
    if (cut <= 0) {
      return;
    }

    const compacted = this.messages.splice(0, cut);
    this.compactionRuns += 1;
    const summaryText = JSON.stringify({
      reason: "manual",
      compactedMessages: compacted.length,
      remainingMessages: this.messages.length,
      cutPoint: cut,
      compactionRun: this.compactionRuns,
      at: nowIso(),
    });

    this.messages.unshift({
      type: "compactionSummary",
      role: "system",
      id: `cmp-${makeId()}`,
      timestamp: nowIso(),
      content: [{ type: "text", text: summaryText }],
    });
  }

  async getState(): Promise<AgentState> {
    return {
      ...this.state,
      queueDepth: { ...this.state.queueDepth },
    };
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async executeImmediately(
    mode: TurnMode,
    input: TurnInput,
  ): Promise<TurnResult> {
    if (this.running) {
      await this.cancelCurrentTurn();
    }
    return this.runTurn(mode, input);
  }

  private enqueueTurn(mode: TurnMode, input: TurnInput): Promise<TurnResult> {
    return new Promise<TurnResult>((resolve, reject) => {
      const queued: QueuedTurn = { mode, input, resolve, reject };
      if (mode === "steer") {
        this.steerQueue.push(queued);
      } else {
        this.followUpQueue.push(queued);
      }
      this.recomputeQueueDepth();
      this.pumpQueue();
    });
  }

  private pumpQueue(): void {
    if (this.pumpPromise) {
      return;
    }

    this.pumpPromise = (async () => {
      while (!this.running) {
        const next = this.steerQueue.shift() ?? this.followUpQueue.shift();
        this.recomputeQueueDepth();
        if (!next) {
          break;
        }
        try {
          const result = await this.runTurn(next.mode, next.input);
          next.resolve(result);
        } catch (error) {
          next.reject(error);
        }
      }
    })().finally(() => {
      this.pumpPromise = null;
      if (this.steerQueue.length > 0 || this.followUpQueue.length > 0) {
        this.pumpQueue();
      }
    });
  }

  private async runTurn(mode: TurnMode, input: TurnInput): Promise<TurnResult> {
    const turnId = makeId();
    this.currentAbort = new AbortController();
    this.running = true;
    this.state.currentTurnId = turnId;
    this.state.isRunning = true;

    const events: AgentEvent[] = [];
    const record = (event: AgentEvent): void => {
      events.push(event);
      this.emit(event);
    };

    this.messages.push(input.message);
    record({
      type: "agent_start",
      sessionId: this.state.sessionId,
      turnId,
      at: nowIso(),
    });
    record({
      type: "turn_start",
      sessionId: this.state.sessionId,
      turnId,
      at: nowIso(),
    });

    let textStarted = false;
    let textBuffer = "";
    let continueGeneration = true;
    let stopReason: "stop" | "tool" | "max_tokens" = "stop";

    while (continueGeneration && !this.currentAbort.signal.aborted) {
      continueGeneration = false;
      let toolBuffer = "";
      let toolCallId = `call-${makeId()}`;
      let sawToolCallEnd = false;

      const { stream } = this.llmProvider.stream(this.model, this.messages, {
        signal: this.currentAbort.signal,
      });

      for await (const llmEvent of stream) {
        if (this.currentAbort.signal.aborted) {
          break;
        }
        const mapped = this.mapLlmEvent(turnId, llmEvent, toolCallId);
        if (mapped) {
          record(mapped);
        }

        if (llmEvent.type === "text_delta") {
          if (!textStarted) {
            record({
              type: "text_start",
              sessionId: this.state.sessionId,
              turnId,
              at: nowIso(),
              text: "",
            });
            textStarted = true;
          }
          textBuffer += llmEvent.payload ?? "";
        }

        if (llmEvent.type === "toolcall_start") {
          toolCallId = llmEvent.payload?.startsWith("call-")
            ? llmEvent.payload
            : `call-${makeId()}`;
          toolBuffer = "";
        }

        if (llmEvent.type === "toolcall_delta") {
          toolBuffer += llmEvent.payload ?? "";
        }

        if (llmEvent.type === "toolcall_end") {
          sawToolCallEnd = true;
          const invocation = parseToolInvocation(toolBuffer || llmEvent.payload);
          if (invocation) {
            const output = await this.toolRegistry.execute(this.toolContext(), invocation);
            const toolMessage: AgentMessage = {
              ...output.content,
              toolCallId,
              toolName: invocation.name,
              parentId: input.message.id,
            };
            this.messages.push(toolMessage);
            continueGeneration = true;
            stopReason = "tool";
          }
        }

        if (llmEvent.type === "done" && !sawToolCallEnd) {
          stopReason = mode === "followUp" ? "max_tokens" : "stop";
        }
      }

      if (sawToolCallEnd && continueGeneration) {
        continue;
      }
    }

    if (textStarted) {
      record({
        type: "text_end",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        text: textBuffer,
      });
    }

    if (!this.currentAbort.signal.aborted) {
      this.messages.push({
        type: "assistant",
        role: "assistant",
        id: `asst-${makeId()}`,
        parentId: input.message.id,
        timestamp: nowIso(),
        model: this.model.modelId,
        content: [{ type: "text", text: textBuffer || `mode=${mode}` }],
      });

      record({
        type: "done",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        stopReason,
      });
    }

    this.running = false;
    this.state.isRunning = false;
    this.currentAbort = null;

    if (this.config.autoCompaction) {
      const limit = Math.max(1, this.config.contextWindowTokens - this.config.reserveTokens);
      if (this.messages.length > limit) {
        await this.compact();
      }
    }

    this.syncState();
    return { events, finalState: await this.getState() };
  }

  private findCompactionCutPoint(): number {
    if (this.messages.length < 3) {
      return 0;
    }

    const budget = Math.floor(this.messages.length / 2);
    let cut = budget;

    while (cut > 0 && this.isBoundaryUnsafe(cut)) {
      cut -= 1;
    }

    return cut;
  }

  private isBoundaryUnsafe(cut: number): boolean {
    const left = this.messages[cut - 1];
    const right = this.messages[cut];
    if (!left || !right) {
      return false;
    }

    return (
      left.type === "assistant"
      && right.type === "toolResult"
      && left.id === right.parentId
    );
  }

  private mapLlmEvent(
    turnId: string,
    event: LlmEvent,
    toolCallId: string,
  ): AgentEvent | null {
    if (event.type === "start" || event.type === "done") {
      return null;
    }

    if (event.type === "text_delta") {
      return {
        type: "text_delta",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        text: event.payload,
      };
    }

    if (
      event.type === "toolcall_start"
      || event.type === "toolcall_delta"
      || event.type === "toolcall_end"
    ) {
      const toolEvent: ToolCallEvent = {
        type: event.type,
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        toolCallId,
        payload: event.payload,
      };
      return toolEvent;
    }

    if (event.type === "error") {
      return {
        type: "error",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        code: "LLM_ERROR",
        message: event.payload ?? "unknown LLM error",
      };
    }

    return null;
  }

  private toolContext(): ToolContext {
    return {
      sessionId: this.state.sessionId,
      extensionId: "agent-runtime",
      capabilities: new Set(["tool:read", "tool:write", "tool:edit", "tool:bash"]),
      trust: "trusted",
    };
  }

  private recomputeQueueDepth(): void {
    this.queueDepth = {
      steer: this.steerQueue.length,
      followUp: this.followUpQueue.length,
    };
    this.syncState();
  }

  private syncState(): void {
    this.state.queueDepth = { ...this.queueDepth };
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export class InMemoryAgentSessionFactory implements AgentSessionFactory {
  async start(config: AgentConfig): Promise<AgentSession> {
    return new InMemoryAgentSession(config);
  }

  async stop(sessionId: string): Promise<void> {
    await Promise.resolve(sessionId);
  }
}

export function createAgentSession(config: AgentConfig): Promise<AgentSession> {
  return new InMemoryAgentSessionFactory().start(config);
}
