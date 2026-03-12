import type {
  AgentEvent,
  AgentMessage,
  QueueBehavior,
  QueueRequest,
} from "@pi-bun-effect/core";

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
type TurnMode = "prompt" | QueueBehavior;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function waitForTurnWindow(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function compactionCutPoint<
  T extends Pick<AgentMessage, "role" | "type">,
>(
  nodes: T[],
  budget: number,
): number {
  if (nodes.length <= budget) {
    return nodes.length;
  }

  const cut = budget;
  const prior = nodes[cut - 1];
  const next = nodes[cut];

  if (
    prior?.role === "assistant"
    && prior.type === "assistant"
    && next?.type === "toolResult"
  ) {
    return cut;
  }

  if (prior?.role === "tool" && prior.type === "toolResult") {
    return cut;
  }

  return cut;
}

export class InMemoryAgentSession implements AgentSession {
  private state: AgentState;
  private listeners = new Set<Listener>();
  private running = false;
  private queueDepth = { steer: 0, followUp: 0 };
  private pending: QueueRequest[] = [];
  private history: AgentMessage[] = [];

  constructor(private readonly config: AgentConfig) {
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
    this.history.push(input.message);
    return this.executeTurn("prompt", input.message.id);
  }

  async steer(input: TurnInput): Promise<TurnResult> {
    this.history.push(input.message);
    return this.requestQueue(
      {
        queue: "steer",
        content: input.message.id,
      } as const,
    ).then(() => this.executeTurn("steer", input.message.id));
  }

  async followUp(input: TurnInput): Promise<TurnResult> {
    this.history.push(input.message);
    return this.requestQueue(
      {
        queue: "followUp",
        content: input.message.id,
      } as const,
    ).then(() => this.executeTurn("followUp", input.message.id));
  }

  async requestQueue(request: QueueRequest): Promise<void> {
    this.pending.push(request);
    this.bumpQueueDepth(request.queue, 1);
  }

  async cancelCurrentTurn(): Promise<void> {
    if (this.running) {
      this.running = false;
      this.state.isRunning = false;
      this.emit({
        type: "abort",
        sessionId: this.state.sessionId,
        turnId: this.state.currentTurnId,
        at: nowIso(),
      });
    }
  }

  async compact(): Promise<void> {
    const budget = Math.max(1, Math.floor(this.history.length / 2));
    const cut = compactionCutPoint(this.history, budget);

    if (cut > 0 && cut < this.history.length) {
      this.history = this.history.slice(cut);

      this.emit({
        type: "text_start",
        sessionId: this.state.sessionId,
        turnId: this.state.currentTurnId,
        at: nowIso(),
        text: `[System: Compacted ${cut} messages from history]`,
      } as AgentEvent);
    }
  }

  async getState(): Promise<AgentState> {
    return this.snapshotState();
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async executeTurn(
    mode: TurnMode,
    sourceId: string,
  ): Promise<TurnResult> {
    const turnId = makeId();
    this.running = true;
    this.state.currentTurnId = turnId;
    this.state.isRunning = true;

    const events: AgentEvent[] = [
      {
        type: "agent_start",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
      },
      {
        type: "turn_start",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
      },
      {
        type: "text_start",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        text: `mode=${mode}`,
      },
    ];

    for (const event of events) {
      this.emit(event);
    }

    await waitForTurnWindow();
    if (!this.running) {
      this.completeQueuedTurn();
      return { events, finalState: this.snapshotState() };
    }

    const completionEvents: AgentEvent[] = [
      {
        type: "text_delta",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        text: `received=${sourceId}`,
      },
      {
        type: "text_end",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        text: "",
      },
      {
        type: "done",
        sessionId: this.state.sessionId,
        turnId,
        at: nowIso(),
        stopReason: "stop",
      } as AgentEvent,
    ];

    for (const event of completionEvents) {
      events.push(event);
      this.emit(event);
    }

    this.running = false;
    this.state.isRunning = false;
    this.completeQueuedTurn();

    return { events, finalState: this.snapshotState() };
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private bumpQueueDepth(queue: QueueRequest["queue"], delta: number): void {
    if (queue === "steer") {
      this.queueDepth.steer += delta;
    } else {
      this.queueDepth.followUp += delta;
    }
    this.state.queueDepth = { ...this.queueDepth };
  }

  private completeQueuedTurn(): void {
    this.running = false;
    this.state.isRunning = false;
    const next = this.pending.shift();
    if (next) {
      this.bumpQueueDepth(next.queue, -1);
      return;
    }

    this.state.queueDepth = { ...this.queueDepth };
  }

  private snapshotState(): AgentState {
    return {
      ...this.state,
      queueDepth: { ...this.queueDepth },
    };
  }
}

export class InMemoryAgentSessionFactory implements AgentSessionFactory {
  async start(config: AgentConfig): Promise<AgentSession> {
    return new InMemoryAgentSession(config);
  }

  async stop(_sessionId: string): Promise<void> {
    return;
  }
}

export function createAgentSession(config: AgentConfig): Promise<AgentSession> {
  return new InMemoryAgentSessionFactory().start(config);
}
