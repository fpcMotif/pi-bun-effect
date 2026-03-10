import type {
  AgentEvent,
  AgentMessage,
  QueueRequest,
  ToolCallEvent,
} from "@pi-bun-effect/core";
import type { LlmEvent, LlmModelId, LlmProvider } from "@pi-bun-effect/llm";
import { createDefaultLlmProvider } from "@pi-bun-effect/llm";
import type { SessionStore } from "@pi-bun-effect/session";
import { createSessionStore } from "@pi-bun-effect/session";
import type { ToolContext, ToolInvocation, ToolRegistry } from "@pi-bun-effect/tools";
import { createToolRegistry } from "@pi-bun-effect/tools";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export interface AgentConfig {
  sessionId: string;
  contextWindowTokens: number;
  reserveTokens: number;
  autoCompaction: boolean;
  sessionPath?: string;
  model?: LlmModelId;
  llmProvider?: LlmProvider;
  toolRegistry?: ToolRegistry;
  sessionStore?: SessionStore;
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

interface TurnRequest {
  mode: TurnMode;
  input: TurnInput;
  resolve: (result: TurnResult) => void;
  reject: (error: unknown) => void;
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

function estimateTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    for (const block of message.content) {
      total += Math.ceil((block.text?.length ?? 0) / 4);
    }
  }
  return total;
}

function toToolContext(sessionId: string): ToolContext {
  return {
    sessionId,
    extensionId: "runtime",
    capabilities: new Set(),
    trust: "trusted",
  };
}

function textMessage(role: "assistant" | "system", text: string): AgentMessage {
  if (role === "assistant") {
    return {
      type: "assistant",
      role,
      id: randomUUID(),
      timestamp: nowIso(),
      content: [{ type: "text", text }],
    };
  }
  return {
    type: "compactionSummary",
    role,
    id: randomUUID(),
    timestamp: nowIso(),
    content: [{ type: "text", text }],
  };
}

export class InMemoryAgentSession implements AgentSession {
  private state: AgentState;
  private listeners = new Set<Listener>();
  private queueDepth = { steer: 0, followUp: 0 };
  private readonly turnQueue: TurnRequest[] = [];
  private readonly provider: LlmProvider;
  private readonly model: LlmModelId;
  private readonly tools: ToolRegistry;
  private readonly store: SessionStore;
  private readonly sessionPath: string;
  private readonly context: AgentMessage[] = [];
  private activeAbortController: AbortController | null = null;
  private queuePump: Promise<void> | null = null;
  private activeToolExecution = false;
  private interruptAfterTool = false;

  constructor(private readonly config: AgentConfig) {
    this.provider = config.llmProvider ?? createDefaultLlmProvider();
    this.tools = config.toolRegistry ?? createToolRegistry();
    this.store = config.sessionStore ?? createSessionStore();
    this.model = config.model ?? { provider: "openai", modelId: "gpt-4o-mini" };
    this.sessionPath = config.sessionPath
      ?? join(process.cwd(), ".sessions", `${config.sessionId}.jsonl`);

    this.state = {
      sessionId: config.sessionId,
      currentTurnId: makeId(),
      isRunning: false,
      queueDepth: {
        steer: 0,
        followUp: 0,
      },
    };
  }

  async prompt(input: TurnInput): Promise<TurnResult> {
    return this.enqueueTurn("prompt", input);
  }

  async steer(input: TurnInput): Promise<TurnResult> {
    return this.enqueueTurn("steer", input);
  }

  async followUp(input: TurnInput): Promise<TurnResult> {
    return this.enqueueTurn("followUp", input);
  }

  async requestQueue(request: QueueRequest): Promise<void> {
    if (request.queue === "steer") {
      this.queueDepth.steer += 1;
      if (this.activeToolExecution) {
        this.interruptAfterTool = true;
      }
    } else {
      this.queueDepth.followUp += 1;
    }
    this.syncQueueDepth();
  }

  async cancelCurrentTurn(): Promise<void> {
    this.activeAbortController?.abort("cancelCurrentTurn");
    this.interruptAfterTool = true;
    const pending = this.turnQueue.splice(0, this.turnQueue.length);
    for (const item of pending) {
      item.reject(new Error("Turn cancelled"));
    }
    this.queueDepth = { steer: 0, followUp: 0 };
    this.syncQueueDepth();
    if (this.state.isRunning) {
      this.emit({
        type: "abort",
        sessionId: this.state.sessionId,
        turnId: this.state.currentTurnId,
        at: nowIso(),
      });
    }
  }

  async compact(): Promise<void> {
    const summary = `Compacted ${this.context.length} message(s) at ${nowIso()}`;
    const entry = textMessage("system", summary);
    this.context.push(entry);
    await this.store.append(this.sessionPath, {
      type: entry.type,
      data: entry,
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

  private enqueueTurn(mode: TurnMode, input: TurnInput): Promise<TurnResult> {
    if (mode === "steer") {
      this.queueDepth.steer += 1;
      if (this.activeToolExecution) {
        this.interruptAfterTool = true;
      }
    }
    if (mode === "followUp") {
      this.queueDepth.followUp += 1;
    }
    this.syncQueueDepth();

    return new Promise<TurnResult>((resolve, reject) => {
      this.turnQueue.push({ mode, input, resolve, reject });
      this.ensurePump();
    });
  }

  private ensurePump(): void {
    if (this.queuePump) {
      return;
    }

    this.queuePump = (async () => {
      while (this.turnQueue.length > 0) {
        const next = this.turnQueue.shift();
        if (!next) {
          break;
        }
        try {
          const result = await this.executeTurn(next.mode, next.input);
          next.resolve(result);
        } catch (error) {
          next.reject(error);
        }
      }
      this.queuePump = null;
    })();
  }

  private async executeTurn(mode: TurnMode, input: TurnInput): Promise<TurnResult> {
    const turnId = makeId();
    this.state.currentTurnId = turnId;
    this.state.isRunning = true;
    this.activeAbortController = new AbortController();
    this.interruptAfterTool = false;

    if (mode === "steer") {
      this.queueDepth.steer = Math.max(0, this.queueDepth.steer - 1);
    } else if (mode === "followUp") {
      this.queueDepth.followUp = Math.max(0, this.queueDepth.followUp - 1);
    }
    this.syncQueueDepth();

    const events: AgentEvent[] = [];
    const emitEvent = (event: AgentEvent) => {
      events.push(event);
      this.emit(event);
    };

    emitEvent({ type: "agent_start", sessionId: this.state.sessionId, turnId, at: nowIso() });
    emitEvent({ type: "turn_start", sessionId: this.state.sessionId, turnId, at: nowIso() });

    this.context.push(input.message);
    await this.store.append(this.sessionPath, {
      type: input.message.type,
      data: input.message,
    });

    try {
      let shouldContinue = true;
      while (shouldContinue && !this.activeAbortController.signal.aborted) {
        shouldContinue = await this.runLlmCycle(turnId, emitEvent);
      }
    } catch (error) {
      emitEvent({
        type: "error",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        code: "TURN_EXECUTION_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    if (this.activeAbortController.signal.aborted) {
      emitEvent({
        type: "abort",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
      });
    }

    await this.autoCompactIfNeeded();

    emitEvent({
      type: "done",
      sessionId: this.state.sessionId,
      turnId,
      at: nowIso(),
      stopReason: this.activeAbortController.signal.aborted ? "max_tokens" : "stop",
    });

    this.state.isRunning = false;
    this.activeAbortController = null;
    return { events, finalState: await this.getState() };
  }

  private async runLlmCycle(
    turnId: string,
    emitEvent: (event: AgentEvent) => void,
  ): Promise<boolean> {
    const { stream } = this.provider.stream(this.model, [...this.context], {
      signal: this.activeAbortController?.signal,
    });

    let currentToolCall: { id: string; name?: string; payload: string } | null = null;
    let assistantText = "";

    for await (const llmEvent of stream) {
      if (this.activeAbortController?.signal.aborted) {
        return false;
      }

      this.emitLlmEvent(turnId, llmEvent, emitEvent, currentToolCall?.id);
      if (llmEvent.type === "text_delta") {
        assistantText += llmEvent.payload ?? "";
      }

      if (llmEvent.type === "toolcall_start") {
        currentToolCall = { id: randomUUID(), name: llmEvent.payload ?? undefined, payload: "" };
      } else if (llmEvent.type === "toolcall_delta") {
        if (currentToolCall) {
          currentToolCall.payload += llmEvent.payload ?? "";
        }
      } else if (llmEvent.type === "toolcall_end") {
        if (!currentToolCall) {
          continue;
        }

        const toolNameFromPayload = this.parseToolInvocation(currentToolCall.payload).name;
        currentToolCall.name = toolNameFromPayload;
        const toolOutput = await this.executeToolCall(currentToolCall);
        this.context.push(toolOutput.content);
        await this.store.append(this.sessionPath, {
          type: toolOutput.content.type,
          data: toolOutput.content,
        });

        if (this.interruptAfterTool) {
          this.activeAbortController?.abort("interruptAfterTool");
          return false;
        }

        return true;
      }

      if (llmEvent.type === "done") {
        if (assistantText) {
          const assistant = textMessage("assistant", assistantText);
          this.context.push(assistant);
          await this.store.append(this.sessionPath, {
            type: assistant.type,
            data: assistant,
          });
        }
        return false;
      }
    }

    return false;
  }

  private parseToolInvocation(payload: string): ToolInvocation {
    try {
      const parsed = JSON.parse(payload) as Partial<ToolInvocation>;
      return {
        name: typeof parsed.name === "string" ? parsed.name : "",
        input: typeof parsed.input === "object" && parsed.input !== null
          ? parsed.input as Record<string, unknown>
          : {},
        raw: payload,
      };
    } catch {
      return { name: "", input: {}, raw: payload };
    }
  }

  private async executeToolCall(
    toolCall: { id: string; name?: string; payload: string },
  ) {
    this.activeToolExecution = true;
    try {
      const invocation = this.parseToolInvocation(toolCall.payload);
      if (!invocation.name) {
        return {
          content: {
            type: "toolResult",
            role: "tool",
            id: randomUUID(),
            timestamp: nowIso(),
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            isError: true,
            content: [{ type: "text", text: "invalid tool invocation" }],
          } as AgentMessage,
        };
      }

      return await this.tools.execute(toToolContext(this.state.sessionId), invocation);
    } finally {
      this.activeToolExecution = false;
    }
  }

  private async autoCompactIfNeeded(): Promise<void> {
    if (!this.config.autoCompaction) {
      return;
    }
    const budget = Math.max(0, this.config.contextWindowTokens - this.config.reserveTokens);
    if (budget === 0) {
      return;
    }

    if (estimateTokens(this.context) >= budget) {
      await this.compact();
    }
  }

  private emitLlmEvent(
    turnId: string,
    llmEvent: LlmEvent,
    emitEvent: (event: AgentEvent) => void,
    toolCallId: string | undefined,
  ): void {
    const base = {
      sessionId: this.state.sessionId,
      turnId,
      at: nowIso(),
    };
    if (llmEvent.type === "start") {
      emitEvent({ ...base, type: "text_start", text: llmEvent.payload });
      return;
    }
    if (llmEvent.type === "text_delta") {
      emitEvent({ ...base, type: "text_delta", text: llmEvent.payload });
      return;
    }
    if (llmEvent.type === "toolcall_start" || llmEvent.type === "toolcall_delta" || llmEvent.type === "toolcall_end") {
      emitEvent({
        ...base,
        type: llmEvent.type,
        toolCallId: toolCallId ?? randomUUID(),
        payload: llmEvent.payload,
      } satisfies ToolCallEvent);
      return;
    }
    if (llmEvent.type === "done") {
      emitEvent({ ...base, type: "text_end", text: llmEvent.payload });
      return;
    }
    if (llmEvent.type === "error") {
      emitEvent({
        ...base,
        type: "error",
        code: "LLM_ERROR",
        message: llmEvent.payload ?? "Unknown LLM error",
      });
    }
  }

  private syncQueueDepth(): void {
    this.state.queueDepth = {
      steer: this.queueDepth.steer,
      followUp: this.queueDepth.followUp,
    };
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
