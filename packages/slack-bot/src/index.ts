export interface SlackConfig {
  token: string;
  signingSecret?: string;
  socketMode: boolean;
}

export interface ToolPolicy {
  defaultAllowedTools?: string[];
  channelAllowedTools?: Record<string, string[]>;
  deniedTools?: string[];
}

export interface SlackBot {
  start(config: SlackConfig): Promise<void>;
  stop(): Promise<void>;
}

export interface SlackEvent {
  channel: string;
  user: string;
  text: string;
  threadTs?: string;
}

export interface ChannelState {
  channelId: string;
  sessionId: string;
  messageCount: number;
  lastPrompt?: string;
}

export interface SlackEnvelope {
  type: "event_callback" | "url_verification";
  challenge?: string;
  event?: {
    type: string;
    channel?: string;
    user?: string;
    text?: string;
    thread_ts?: string;
  };
}

export class InMemorySlackBot implements SlackBot {
  private running = false;
  private readonly channels = new Map<string, ChannelState>();
  private readonly channelSessions = new Map<string, string>();

  constructor(private readonly policy: ToolPolicy = {}) {}

  async start(_config: SlackConfig): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  ingestEvent(payload: SlackEnvelope): ChannelState | { challenge: string } | null {
    if (payload.type === "url_verification") {
      return { challenge: payload.challenge ?? "" };
    }

    if (
      payload.type !== "event_callback" ||
      !payload.event ||
      payload.event.type !== "message" ||
      !payload.event.channel ||
      !payload.event.user ||
      typeof payload.event.text !== "string"
    ) {
      return null;
    }

    return this.routeEvent({
      channel: payload.event.channel,
      user: payload.event.user,
      text: payload.event.text,
      threadTs: payload.event.thread_ts,
    });
  }

  routeEvent(event: SlackEvent): ChannelState {
    const sessionId = this.getOrCreateSessionId(event.channel);
    const existing = this.channels.get(event.channel) ?? {
      channelId: event.channel,
      sessionId,
      messageCount: 0,
    };
    existing.sessionId = sessionId;
    existing.messageCount += 1;
    existing.lastPrompt = event.text;
    this.channels.set(event.channel, existing);
    return existing;
  }

  getOrCreateSessionId(channelId: string): string {
    const existing = this.channelSessions.get(channelId);
    if (existing) {
      return existing;
    }
    const created = `slack-${channelId}`;
    this.channelSessions.set(channelId, created);
    return created;
  }

  isToolAllowed(channelId: string, toolName: string): boolean {
    if (this.policy.deniedTools?.includes(toolName)) {
      return false;
    }

    const channelAllowList = this.policy.channelAllowedTools?.[channelId];
    if (channelAllowList) {
      return channelAllowList.includes(toolName);
    }

    const globalAllowList = this.policy.defaultAllowedTools;
    if (globalAllowList) {
      return globalAllowList.includes(toolName);
    }

    return true;
  }

  listChannels(): string[] {
    return Array.from(this.channels.keys());
  }
}

export function createSlackBot(policy?: ToolPolicy): InMemorySlackBot {
  return new InMemorySlackBot(policy);
}
