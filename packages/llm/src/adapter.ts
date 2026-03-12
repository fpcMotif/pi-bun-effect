import type { AgentMessage } from "@pi-bun-effect/core";
import { randomUUID } from "node:crypto";

export type ProviderId = "openai" | "anthropic" | "google" | "custom";

export interface LlmModelId {
  provider: ProviderId;
  modelId: string;
  apiVariant?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd?: number;
}

export interface LlmEvent {
  type:
    | "start"
    | "text_delta"
    | "toolcall_start"
    | "toolcall_delta"
    | "toolcall_end"
    | "done"
    | "error";
  payload?: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code = "LLM_ERROR",
  ) {
    super(message);
  }
}

export interface LlmStreamResult {
  stream: AsyncGenerator<LlmEvent>;
  usage?: Usage;
}

export interface LlmProvider {
  configure(apiKey: string, baseUrl?: string): Promise<void>;
  modelRegistry(): Promise<LlmModelId[]>;
  stream(
    model: LlmModelId,
    context: AgentMessage[],
    options?: LlmOptions,
  ): LlmStreamResult;
  complete(
    model: LlmModelId,
    context: AgentMessage[],
    options?: LlmOptions,
  ): Promise<AgentMessage>;
}

export interface LlmProviderFactory {
  create(provider: ProviderId): LlmProvider;
}

const defaultModels: Record<ProviderId, LlmModelId[]> = {
  openai: [
    { provider: "openai", modelId: "gpt-4o" },
    { provider: "openai", modelId: "gpt-4o-mini" },
  ],
  anthropic: [
    { provider: "anthropic", modelId: "claude-3.5-sonnet" },
    { provider: "anthropic", modelId: "claude-3-haiku" },
  ],
  google: [
    { provider: "google", modelId: "gemini-2.0-flash" },
    { provider: "google", modelId: "gemini-1.5-pro" },
  ],
  custom: [],
};

function toolCallPayloadFromContext(context: AgentMessage[]): string {
  const last = context[context.length - 1];
  if (!last) return "{}";
  return JSON.stringify(last);
}

export class ReplayLlmProvider implements LlmProvider {
  private apiKey = "";
  private baseUrl?: string;

  constructor(public readonly provider: ProviderId = "openai") {}

  async configure(apiKey: string, baseUrl?: string): Promise<void> {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async modelRegistry(): Promise<LlmModelId[]> {
    return defaultModels[this.provider] ?? [];
  }

  stream(
    model: LlmModelId,
    context: AgentMessage[],
    options?: LlmOptions,
  ): LlmStreamResult {
    const events: LlmEvent[] = [
      {
        type: "start",
        payload: JSON.stringify({
          model: model.modelId,
          temperature: options?.temperature ?? 0.5,
        }),
      },
      { type: "text_delta", payload: `provider=${model.provider}` },
      { type: "toolcall_start", payload: `tool:${model.modelId}` },
      { type: "toolcall_delta", payload: toolCallPayloadFromContext(context) },
      { type: "toolcall_end", payload: toolCallPayloadFromContext(context) },
      { type: "done", payload: "" },
    ];

    async function* toGenerator(): AsyncGenerator<LlmEvent> {
      for (const event of events) {
        yield event;
      }
    }

    return {
      stream: toGenerator(),
      usage: {
        inputTokens: context.length,
        outputTokens: Math.max(1, context.length),
        totalCostUsd: context.length > 10 ? 0.001 : 0,
      },
    };
  }

  async complete(
    model: LlmModelId,
    context: AgentMessage[],
    options?: LlmOptions,
  ): Promise<AgentMessage> {
    await Promise.resolve(
      {
        model,
        options,
        provider: this.provider,
        baseUrl: this.baseUrl,
      } as const,
    );
    return {
      type: "assistant",
      role: "assistant",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      model: model.modelId,
      content: [
        {
          type: "text",
          text: `replayed by ${this.provider}::${model.modelId}`,
        },
      ],
    };
  }
}

export class LlmProviderRegistry {
  constructor(
    private readonly factories: Partial<Record<ProviderId, LlmProviderFactory>>,
  ) {}

  create(provider: ProviderId): LlmProvider {
    const factory = this.factories[provider];
    if (factory) {
      return factory.create(provider);
    }
    return new ReplayLlmProvider(provider);
  }
}

export function createDefaultLlmProvider(): LlmProvider {
  return new ReplayLlmProvider("openai");
}

export function createMockLlmProvider(modelEvents: LlmEvent[]): LlmProvider {
  return {
    async configure() {},
    async modelRegistry() {
      return Object.values(defaultModels).flat();
    },
    stream(_, __) {
      async function* emitter(): AsyncGenerator<LlmEvent> {
        for (const event of modelEvents) {
          yield event;
        }
      }
      return {
        stream: emitter(),
      };
    },
    async complete(model) {
      return {
        type: "assistant",
        role: "assistant",
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        model: model.modelId,
        content: [
          {
            type: "text",
            text: "mock-complete",
          },
        ],
      };
    },
  };
}
