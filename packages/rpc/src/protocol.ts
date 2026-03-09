import {
  type AgentMessage,
  type ContentBlock,
  isAgentMessage,
  type QueueBehavior,
} from "@pi-bun-effect/core";

export type RpcCommandName =
  | "prompt"
  | "steer"
  | "followUp"
  | "follow_up"
  | "abort"
  | "get_state"
  | "get_messages"
  | "set_model"
  | "cycle_model"
  | "get_available_models"
  | "set_thinking_level"
  | "cycle_thinking_level"
  | "set_steering_mode"
  | "set_follow_up_mode"
  | "compact"
  | "set_auto_compaction"
  | "set_auto_retry"
  | "abort_retry"
  | "bash"
  | "new_session"
  | "switch"
  | "fork"
  | "tree_navigation";

const VALID_COMMANDS = new Set<RpcCommandName>([
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
]);

export interface RpcRequestBase {
  id: string;
  command: RpcCommandName;
}

export interface PromptPayload {
  message: AgentMessage;
  mode?: "print" | "json";
  queue?: QueueBehavior;
}

export interface SetModelPayload {
  provider: string;
  modelId: string;
}

export type RpcPayloads =
  | PromptPayload
  | SetModelPayload
  | { sessionId: string }
  | { text: string }
  | Record<string, unknown>
  | undefined;

export interface RpcRequest extends RpcRequestBase {
  payload?: RpcPayloads;
}

export type RpcResponseStatus = "ok" | "error";

export interface RpcResponse<T = unknown> {
  id: string;
  command: RpcCommandName;
  status: RpcResponseStatus;
  result?: T;
  error?: string;
}

export interface RpcEvent {
  type: "agent_event";
  id: string;
  command: RpcCommandName;
  payload: unknown;
}

export interface RpcProtocol {
  parseLine(line: string): RpcRequest | null;
  encodeResponse(response: RpcResponse): string;
  encodeEvent(event: RpcEvent): string;
}

export class JsonRpcProtocol implements RpcProtocol {
  parseLine(line: string): RpcRequest | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }

    if (!isObject(parsed)) {
      return null;
    }

    const command = parsed.command;
    const id = parsed.id;
    if (
      typeof id !== "string"
      || !VALID_COMMANDS.has(command as RpcCommandName)
    ) {
      return null;
    }

    const payload = this.parsePayload(
      command as RpcCommandName,
      (parsed as { payload?: unknown }).payload,
    );
    if (payload === null) {
      return null;
    }

    return {
      id,
      command: command as RpcCommandName,
      payload,
    };
  }

  encodeResponse(response: RpcResponse): string {
    return JSON.stringify(response);
  }

  encodeEvent(event: RpcEvent): string {
    return JSON.stringify(event);
  }

  private parsePayload(
    command: RpcCommandName,
    payload: unknown,
  ): RpcPayloads | null {
    if (command !== "prompt") {
      return payload as RpcPayloads;
    }

    if (!isObject(payload)) {
      return null;
    }

    const message = payload.message;
    if (!isAgentMessage(message)) {
      return null;
    }

    const normalized = normalizeContentBlocks(message.content);
    if (!normalized) {
      return null;
    }

    return {
      ...(payload as PromptPayload),
      message: {
        ...message,
        content: normalized,
      },
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeContentBlocks(blocks: unknown): ContentBlock[] | null {
  if (!Array.isArray(blocks)) {
    return null;
  }

  const normalized: ContentBlock[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      normalized.push({ type: "text", text: block });
      continue;
    }
    if (!isObject(block) || typeof block.type !== "string") {
      return null;
    }

    if (block.type === "text") {
      if (typeof block.text !== "string") {
        return null;
      }
      normalized.push({ type: "text", text: block.text });
      continue;
    }

    if (block.type === "image") {
      if (typeof block.data !== "string" || typeof block.mimeType !== "string") {
        return null;
      }
      normalized.push({ type: "image", data: block.data, mimeType: block.mimeType });
      continue;
    }

    if (block.type === "thinking" || block.type === "toolCall") {
      normalized.push({
        type: block.type,
        text: typeof block.text === "string" ? block.text : undefined,
      });
      continue;
    }

    return null;
  }

  return normalized;
}

export function createRpcProtocol(): RpcProtocol {
  return new JsonRpcProtocol();
}
