import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createRpcProtocol,
  type RpcCommandName,
  type RpcEvent,
  type RpcRequest,
  type RpcResponse,
} from "@pi-bun-effect/rpc";

export interface CliCommand {
  name: string;
  run(args: string[]): Promise<number>;
}

export interface CliMode {
  command: string;
  description: string;
  run(args: string[]): Promise<number>;
}

export interface CliOutput {
  code: number;
  value?: string;
}

interface CliArgs {
  mode: string;
  prompt?: string;
  stream?: boolean;
  help: boolean;
  version: boolean;
  invalidCommand: boolean;
}

interface RpcState {
  sessionId: string;
  turn: number;
  model: { provider: string; modelId: string };
  availableModels: Array<{ provider: string; modelId: string }>;
  thinkingLevel: "low" | "medium" | "high";
  steeringMode: "queue" | "interrupt";
  followUpMode: "append" | "replace";
  autoCompaction: boolean;
  autoRetry: boolean;
  retryInFlight: boolean;
  queued: number;
  messages: unknown[];
  sessions: string[];
}

interface RpcErrorPayload {
  code: "unsupported_command" | "invalid_payload";
  message: string;
  command: string;
  correlationId: string;
  details?: string;
}

type RpcHandler = (
  request: RpcRequest,
  state: RpcState,
) => Promise<RpcResponse> | RpcResponse;

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  const result: CliArgs = {
    mode: "interactive",
    help: false,
    version: false,
    invalidCommand: false,
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--version") {
      result.version = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--mode") {
      const mode = args.shift();
      if (mode) {
        result.mode = mode;
      }
    } else if (arg === "--prompt" || arg === "-p") {
      result.prompt = args.shift();
    } else if (arg === "--stream") {
      result.stream = true;
    } else if (arg && !arg.startsWith("--")) {
      result.prompt ??= arg;
    } else {
      result.invalidCommand = true;
    }
  }

  return result;
}

function printUsage(): void {
  const usage = `pi-bun-effect cli

Usage:
  pi-bun-effect --version
  pi-bun-effect --mode json --prompt "text"
  pi-bun-effect --mode rpc

Notes:
  --mode rpc starts a line-delimited JSON protocol loop.
  --mode json prints a one-shot JSON message and exits.
`;
  console.log(usage);
}

function formatEvent(value: unknown): string {
  return JSON.stringify(value);
}

function makeTurnEvent(
  sessionId: string,
  turn: string,
  payload: string,
): RpcEvent {
  return {
    type: "agent_event",
    id: `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`,
    command: "prompt",
    payload: {
      sessionId,
      turn,
      payload,
    },
  };
}

function createRpcState(): RpcState {
  const sessionId = `session-${Date.now().toString(16)}`;
  return {
    sessionId,
    turn: 0,
    model: { provider: "local", modelId: "default" },
    availableModels: [
      { provider: "local", modelId: "default" },
      { provider: "openai", modelId: "gpt-4o-mini" },
    ],
    thinkingLevel: "medium",
    steeringMode: "queue",
    followUpMode: "append",
    autoCompaction: true,
    autoRetry: true,
    retryInFlight: false,
    queued: 0,
    messages: [],
    sessions: [sessionId],
  };
}

function asRecord(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  return payload as Record<string, unknown>;
}

function errorResponse(
  request: RpcRequest,
  code: RpcErrorPayload["code"],
  message: string,
  details?: string,
): RpcResponse {
  const payload: RpcErrorPayload = {
    code,
    message,
    command: request.command,
    correlationId: request.id,
    details,
  };
  return {
    id: request.id,
    command: request.command,
    status: "error",
    error: message,
    result: { error: payload },
  };
}

function okResponse(request: RpcRequest, result: unknown): RpcResponse {
  return {
    id: request.id,
    command: request.command,
    status: "ok",
    result,
  };
}

const cycleOrder = ["low", "medium", "high"] as const;

const rpcHandlers: Record<RpcCommandName, RpcHandler> = {
  prompt: (request, state) => {
    const payload = asRecord(request.payload);
    const message = payload?.message;
    if (!message || typeof message !== "object") {
      return errorResponse(request, "invalid_payload", "prompt payload.message is required");
    }

    state.turn += 1;
    state.messages.push(message);
    const result = { sessionId: state.sessionId, received: message, turn: state.turn };
    const event = makeTurnEvent(state.sessionId, `${state.turn}`, `${JSON.stringify(result)}`);
    console.log(formatEvent(event));
    return okResponse(request, result);
  },
  steer: (request, state) => {
    state.queued += 1;
    return okResponse(request, { sessionId: state.sessionId, command: request.command, queued: true });
  },
  followUp: (request, state) => {
    state.queued += 1;
    return okResponse(request, { sessionId: state.sessionId, command: request.command, queued: true });
  },
  follow_up: (request, state) => {
    state.queued += 1;
    return okResponse(request, { sessionId: state.sessionId, command: request.command, queued: true });
  },
  abort: (_request, state) => {
    state.queued = 0;
    return {
      id: _request.id,
      command: _request.command,
      status: "ok",
      result: { sessionId: state.sessionId, aborted: true },
    };
  },
  get_state: (request, state) =>
    okResponse(request, {
      sessionId: state.sessionId,
      busy: false,
      queued: state.queued,
      model: state.model,
      autoCompaction: state.autoCompaction,
      autoRetry: state.autoRetry,
    }),
  get_messages: (request, state) =>
    okResponse(request, {
      sessionId: state.sessionId,
      messages: state.messages,
    }),
  set_model: (request, state) => {
    const payload = asRecord(request.payload);
    const provider = payload?.provider;
    const modelId = payload?.modelId;
    if (typeof provider !== "string" || typeof modelId !== "string") {
      return errorResponse(
        request,
        "invalid_payload",
        "set_model payload requires provider and modelId strings",
      );
    }
    state.model = { provider, modelId };
    if (!state.availableModels.some((item) => item.provider === provider && item.modelId === modelId)) {
      state.availableModels.push(state.model);
    }
    return okResponse(request, { model: state.model });
  },
  cycle_model: (request, state) => {
    const currentIndex = state.availableModels.findIndex(
      (item) => item.provider === state.model.provider && item.modelId === state.model.modelId,
    );
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % state.availableModels.length
      : 0;
    state.model = state.availableModels[nextIndex] ?? state.model;
    return okResponse(request, { model: state.model });
  },
  get_available_models: (request, state) => okResponse(request, { models: state.availableModels }),
  set_thinking_level: (request, state) => {
    const payload = asRecord(request.payload);
    const level = payload?.level;
    if (level !== "low" && level !== "medium" && level !== "high") {
      return errorResponse(request, "invalid_payload", "set_thinking_level payload.level must be low|medium|high");
    }
    state.thinkingLevel = level;
    return okResponse(request, { level: state.thinkingLevel });
  },
  cycle_thinking_level: (request, state) => {
    const index = cycleOrder.indexOf(state.thinkingLevel);
    state.thinkingLevel = cycleOrder[(index + 1) % cycleOrder.length] ?? state.thinkingLevel;
    return okResponse(request, { level: state.thinkingLevel });
  },
  set_steering_mode: (request, state) => {
    const payload = asRecord(request.payload);
    const mode = payload?.mode;
    if (mode !== "queue" && mode !== "interrupt") {
      return errorResponse(request, "invalid_payload", "set_steering_mode payload.mode must be queue|interrupt");
    }
    state.steeringMode = mode;
    return okResponse(request, { mode: state.steeringMode });
  },
  set_follow_up_mode: (request, state) => {
    const payload = asRecord(request.payload);
    const mode = payload?.mode;
    if (mode !== "append" && mode !== "replace") {
      return errorResponse(request, "invalid_payload", "set_follow_up_mode payload.mode must be append|replace");
    }
    state.followUpMode = mode;
    return okResponse(request, { mode: state.followUpMode });
  },
  compact: (request, state) => okResponse(request, { sessionId: state.sessionId, compacted: true }),
  set_auto_compaction: (request, state) => {
    const payload = asRecord(request.payload);
    const enabled = payload?.enabled;
    if (typeof enabled !== "boolean") {
      return errorResponse(request, "invalid_payload", "set_auto_compaction payload.enabled must be boolean");
    }
    state.autoCompaction = enabled;
    return okResponse(request, { enabled });
  },
  set_auto_retry: (request, state) => {
    const payload = asRecord(request.payload);
    const enabled = payload?.enabled;
    if (typeof enabled !== "boolean") {
      return errorResponse(request, "invalid_payload", "set_auto_retry payload.enabled must be boolean");
    }
    state.autoRetry = enabled;
    return okResponse(request, { enabled });
  },
  abort_retry: (request, state) => {
    state.retryInFlight = false;
    return okResponse(request, { aborted: true });
  },
  bash: (request) => {
    const payload = asRecord(request.payload);
    const command = payload?.command;
    if (typeof command !== "string" || !command.trim()) {
      return errorResponse(request, "invalid_payload", "bash payload.command must be a non-empty string");
    }
    return okResponse(request, { accepted: true, command });
  },
  new_session: (request, state) => {
    const sessionId = `session-${Date.now().toString(16)}-${state.sessions.length}`;
    state.sessionId = sessionId;
    state.turn = 0;
    state.messages = [];
    state.sessions.push(sessionId);
    return okResponse(request, { sessionId });
  },
  switch: (request, state) => {
    const payload = asRecord(request.payload);
    const sessionId = payload?.sessionId;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return errorResponse(request, "invalid_payload", "switch payload.sessionId must be a non-empty string");
    }
    if (!state.sessions.includes(sessionId)) {
      state.sessions.push(sessionId);
    }
    state.sessionId = sessionId;
    return okResponse(request, { sessionId: state.sessionId });
  },
  fork: (request, state) => {
    const sessionId = `${state.sessionId}-fork-${Date.now().toString(16)}`;
    state.sessions.push(sessionId);
    state.sessionId = sessionId;
    return okResponse(request, { sessionId });
  },
  tree_navigation: (request) => {
    const payload = asRecord(request.payload);
    const action = payload?.action;
    if (typeof action !== "string" || !action.trim()) {
      return errorResponse(request, "invalid_payload", "tree_navigation payload.action must be a non-empty string");
    }
    return okResponse(request, { action, ok: true });
  },
};

export async function runCli(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const parsed = parseArgs(argv);
  const protocol = createRpcProtocol();

  if (parsed.help || parsed.invalidCommand) {
    printUsage();
    return parsed.invalidCommand ? 2 : 0;
  }

  if (parsed.version) {
    console.log("pi-bun-effect 0.1.0");
    return 0;
  }

  if (parsed.mode === "json") {
    const payload = {
      type: "json_response",
      at: new Date().toISOString(),
      prompt: parsed.prompt ?? "",
      stream: parsed.stream === true,
    };
    console.log(formatEvent(payload));
    return 0;
  }

  if (parsed.mode === "rpc") {
    const raw = await new Response(Bun.stdin).text();
    const lines = raw.split(/\r?\n/);
    const state = createRpcState();

    for (const rawLine of lines) {
      const request = protocol.parseLine(rawLine);
      if (!request) {
        continue;
      }
      const response = await handleRpcCommand(request, state);
      console.log(protocol.encodeResponse(response));
      if (request.command === "abort") {
        break;
      }
    }
    return 0;
  }

  if (parsed.mode === "interactive") {
    const state = createRpcState();

    if (typeof parsed.prompt === "string") {
      const request: RpcRequest = {
        id: `interactive-${Date.now().toString(16)}`,
        command: "prompt",
        payload: {
          message: {
            id: `interactive-msg-${Date.now().toString(16)}`,
            type: "user",
            role: "user",
            timestamp: new Date().toISOString(),
            content: [{ type: "text", text: parsed.prompt }],
          },
        },
      };
      const response = await handleRpcCommand(request, state);
      console.log(formatEvent(response));
      return 0;
    }

    console.log("pi-bun-effect interactive mode");
    console.log("type a message and press enter, use /exit to quit");
    const rl = createInterface({ input, output });
    try {
      while (true) {
        const line = await rl.question("> ");
        if (line.trim() === "/exit") {
          break;
        }
        if (!line.trim()) {
          continue;
        }
        const request: RpcRequest = {
          id: `interactive-${Date.now().toString(16)}`,
          command: "prompt",
          payload: {
            message: {
              id: `interactive-msg-${Date.now().toString(16)}`,
              type: "user",
              role: "user",
              timestamp: new Date().toISOString(),
              content: [{ type: "text", text: line }],
            },
          },
        };
        const response = await handleRpcCommand(request, state);
        console.log(formatEvent(response));
      }
    } finally {
      rl.close();
    }
    return 0;
  }

  const fallback = {
    type: "json_response",
    at: new Date().toISOString(),
    mode: parsed.mode,
    prompt: parsed.prompt ?? "",
  };
  console.log(formatEvent(fallback));
  return 0;
}

async function handleRpcCommand(
  request: RpcRequest,
  state: RpcState,
): Promise<RpcResponse> {
  const handler = rpcHandlers[request.command];
  if (!handler) {
    return errorResponse(
      request,
      "unsupported_command",
      `unsupported command: ${request.command}`,
    );
  }
  return handler(request, state);
}

export function listCliCommands(): CliCommand[] {
  return [
    { name: "version", run: async () => runCli(["--version"]) },
    {
      name: "json",
      run: async (args) => runCli(["--mode", "json", ...args]),
    },
    {
      name: "rpc",
      run: async (args) => runCli(["--mode", "rpc", ...args]),
    },
  ];
}
