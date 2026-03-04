import type {
  AgentEvent,
  AgentMessage,
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

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class InMemoryAgentSession implements AgentSession {
  private state: AgentState;
  private listeners = new Set<Listener>();
  private running = false;
  private queueDepth = { steer: 0, followUp: 0 };
  private pending: QueueRequest[] = [];

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
    return this.executeTurn("prompt", input.message.id);
  }

  async steer(input: TurnInput): Promise<TurnResult> {
    return this.requestQueue(
      {
        queue: "steer",
        content: input.message.id,
      } as const,
    ).then(() => this.executeTurn("steer", input.message.id));
  }

  async followUp(input: TurnInput): Promise<TurnResult> {
    return this.requestQueue(
      {
        queue: "followUp",
        content: input.message.id,
      } as const,
    ).then(() => this.executeTurn("followUp", input.message.id));
  }

  async requestQueue(request: QueueRequest): Promise<void> {
    if (request.queue === "steer") {
      this.queueDepth.steer += 1;
      this.pending.push(request);
    } else {
      this.queueDepth.followUp += 1;
      this.pending.push(request);
    }
  }

  async cancelCurrentTurn(): Promise<void> {
    if (this.running) {
      this.running = false;
      this.emit({
        type: "abort",
        sessionId: this.state.sessionId,
        turnId: this.state.currentTurnId,
        at: nowIso(),
      });
    }
  }

  async compact(): Promise<void> {
    // No-op placeholder in scaffold implementation.
    return undefined;
  }

  async getState(): Promise<AgentState> {
    return {
      ...this.state,
      queueDepth: { ...this.queueDepth },
    };
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async executeTurn(
    mode: string,
    sourceId: string,
  ): Promise<TurnResult> {
    const turnId = makeId();
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

    for (const event of events) {
      this.emit(event);
    }

    this.state.isRunning = false;
    if (this.pending.length > 0) {
      const request = this.pending.shift();
      if (request?.queue === "steer") {
        this.queueDepth.steer -= 1;
      } else {
        this.queueDepth.followUp -= 1;
      }
    }

    this.state.queueDepth = {
      steer: this.queueDepth.steer,
      followUp: this.queueDepth.followUp,
    };

    return { events, finalState: this.state };
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
