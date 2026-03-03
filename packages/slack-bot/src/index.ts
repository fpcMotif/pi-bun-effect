export interface SlackConfig {
  token: string;
  signingSecret?: string;
  socketMode: boolean;
}

export interface SlackBot {
  start(config: SlackConfig): Promise<void>;
  stop(): Promise<void>;
}

export interface SlackEvent {
  channel: string;
  user: string;
  text: string;
}

export interface ChannelState {
  channelId: string;
  messageCount: number;
  lastPrompt?: string;
}

export class InMemorySlackBot implements SlackBot {
  private running = false;
  private readonly channels = new Map<string, ChannelState>();

  async start(_config: SlackConfig): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  routeEvent(event: SlackEvent): ChannelState {
    const existing = this.channels.get(event.channel) ?? {
      channelId: event.channel,
      messageCount: 0
    };
    existing.messageCount += 1;
    existing.lastPrompt = event.text;
    this.channels.set(event.channel, existing);
    return existing;
  }

  listChannels(): string[] {
    return Array.from(this.channels.keys());
  }
}

export function createSlackBot(): InMemorySlackBot {
  return new InMemorySlackBot();
}
