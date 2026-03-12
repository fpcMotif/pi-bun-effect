import type { AgentMessage, QueueBehavior } from "@pi-bun-effect/core";

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

    return {
      id,
      command: command as RpcCommandName,
      payload: (parsed as { payload?: RpcPayloads }).payload,
    };
  }

  encodeResponse(response: RpcResponse): string {
    return JSON.stringify(response);
  }

  encodeEvent(event: RpcEvent): string {
    return JSON.stringify(event);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createRpcProtocol(): RpcProtocol {
  return new JsonRpcProtocol();
}
