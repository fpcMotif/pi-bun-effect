import type { AgentMessage } from "../../core/src/contracts";
import { createSessionStore, type SessionStore } from "../../session/src/index";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface SlackConfig {
  token: string;
  signingSecret?: string;
  socketMode: boolean;
  storageDir?: string;
}

export interface SlackBot {
  start(config: SlackConfig): Promise<void>;
  stop(): Promise<void>;
}

export interface SlackAttachment {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
  url?: string;
}

export interface SlackEvent {
  channel: string;
  user: string;
  text: string;
  attachments?: SlackAttachment[];
}

export interface ChannelState {
  channelId: string;
  sessionId: string;
  messageCount: number;
  lastPrompt?: string;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toLogMessage(event: SlackEvent, sessionId: string): AgentMessage {
  return {
    type: "custom",
    kind: "slack_event",
    role: "system",
    id: makeId(),
    timestamp: new Date().toISOString(),
    content: [
      {
        type: "text",
        text: JSON.stringify({
          sessionId,
          channel: event.channel,
          user: event.user,
          text: event.text,
          attachments: event.attachments ?? [],
        }),
      },
    ],
  };
}

function toMappingMessage(channelId: string, sessionId: string): AgentMessage {
  return {
    type: "custom",
    kind: "slack_channel_mapping",
    role: "system",
    id: makeId(),
    timestamp: new Date().toISOString(),
    content: [{ type: "text", text: JSON.stringify({ channelId, sessionId }) }],
  };
}

export class InMemorySlackBot implements SlackBot {
  private running = false;
  private readonly channels = new Map<string, ChannelState>();
  private readonly store: SessionStore;
  private storageDir = ".pi/slack";

  constructor(store: SessionStore = createSessionStore()) {
    this.store = store;
  }

  async start(config: SlackConfig): Promise<void> {
    this.running = true;
    this.storageDir = config.storageDir ?? this.storageDir;
    await mkdir(this.storageDir, { recursive: true });
    await this.loadChannelsFromDisk();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async routeEvent(event: SlackEvent): Promise<ChannelState> {
    if (!this.running) {
      throw new Error("slack bot is not running");
    }

    const existing = this.channels.get(event.channel) ?? {
      channelId: event.channel,
      sessionId: makeId(),
      messageCount: 0,
    };

    if (!this.channels.has(event.channel)) {
      await this.store.append(this.mappingPath(), {
        type: "custom",
        data: toMappingMessage(event.channel, existing.sessionId),
      });
    }

    existing.messageCount += 1;
    existing.lastPrompt = event.text;
    this.channels.set(event.channel, existing);

    await this.store.append(this.channelPath(event.channel), {
      type: "custom",
      data: toLogMessage(event, existing.sessionId),
    });

    return { ...existing };
  }

  listChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  private mappingPath(): string {
    return join(this.storageDir, "channel-map.jsonl");
  }

  private channelPath(channelId: string): string {
    return join(this.storageDir, `${sanitizeSegment(channelId)}.jsonl`);
  }

  private async loadChannelsFromDisk(): Promise<void> {
    const mappingEntries = await this.store.readAll(this.mappingPath()).catch(() => []);
    for (const entry of mappingEntries) {
      if (entry.data.type !== "custom" || entry.data.kind !== "slack_channel_mapping") {
        continue;
      }
      const textBlock = entry.data.content.find((block) => block.type === "text")?.text;
      if (!textBlock) {
        continue;
      }
      const payload = JSON.parse(textBlock) as { channelId?: string; sessionId?: string };
      if (!payload.channelId || !payload.sessionId) {
        continue;
      }
      this.channels.set(payload.channelId, {
        channelId: payload.channelId,
        sessionId: payload.sessionId,
        messageCount: 0,
      });
    }

    const files = await readdir(this.storageDir).catch(() => []);
    for (const channelId of this.channels.keys()) {
      const fileName = `${sanitizeSegment(channelId)}.jsonl`;
      if (!files.includes(fileName)) {
        continue;
      }
      const entries = await this.store.readAll(join(this.storageDir, fileName));
      const state = this.channels.get(channelId);
      if (!state) {
        continue;
      }
      state.messageCount = entries.length;
      const last = entries.at(-1);
      if (last?.data.type === "custom" && last.data.kind === "slack_event") {
        const textBlock = last.data.content.find((block) => block.type === "text")?.text;
        if (textBlock) {
          const payload = JSON.parse(textBlock) as { text?: string };
          state.lastPrompt = payload.text;
        }
      }
    }
  }
}

export function createSlackBot(store?: SessionStore): InMemorySlackBot {
  return new InMemorySlackBot(store);
}
