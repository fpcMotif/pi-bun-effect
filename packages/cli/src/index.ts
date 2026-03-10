import {
  createRpcProtocol,
  type RpcEvent,
  type RpcRequest,
  type RpcResponse,
  type SandboxMode,
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
  sandboxMode: SandboxMode;
  help: boolean;
  version: boolean;
  invalidCommand: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = [...argv];
  const result: CliArgs = {
    mode: "interactive",
    sandboxMode: "local",
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
    } else if (arg === "--sandbox-mode") {
      const sandboxMode = args.shift();
      if (
        sandboxMode === "local" || sandboxMode === "subprocess-isolated"
        || sandboxMode === "containerized"
      ) {
        result.sandboxMode = sandboxMode;
      } else {
        result.invalidCommand = true;
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
  pi-bun-effect --mode json --prompt "text" [--sandbox-mode local|subprocess-isolated|containerized]
  pi-bun-effect --mode rpc [--sandbox-mode local|subprocess-isolated|containerized]

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
      sandboxMode: parsed.sandboxMode,
    };
    console.log(formatEvent(payload));
    return 0;
  }

  if (parsed.mode === "rpc") {
    const raw = await new Response(Bun.stdin).text();
    const lines = raw.split(/\r?\n/);
    const sessionId = `session-${Date.now().toString(16)}`;

    for (const rawLine of lines) {
      const request = protocol.parseLine(rawLine);
      if (!request) {
        continue;
      }
      const response = await handleRpcCommand(
        protocol,
        request,
        sessionId,
        0,
        parsed.sandboxMode,
      );
      if (response) {
        console.log(protocol.encodeResponse(response));
        if (request.command === "abort") {
          break;
        }
      }
    }
    return 0;
  }

  if (parsed.mode === "interactive" && parsed.prompt === undefined) {
    console.log("pi-bun-effect interactive mode");
    console.log("stdin: interactive loop not yet implemented in bootstrap");
    return 0;
  }

  const fallback = {
    type: "json_response",
    at: new Date().toISOString(),
    mode: parsed.mode,
    prompt: parsed.prompt ?? "",
    sandboxMode: parsed.sandboxMode,
  };
  console.log(formatEvent(fallback));
  return 0;
}

async function handleRpcCommand(
  protocol: ReturnType<typeof createRpcProtocol>,
  request: RpcRequest,
  sessionId: string,
  turn: number,
  sandboxMode: SandboxMode,
): Promise<RpcResponse> {
  if (request.command === "prompt") {
    const prompt = (
      request.payload as { message?: { content?: unknown[] } } | undefined
    )?.message;
    const payload = { sessionId, received: prompt ?? null, turn, sandboxMode };
    const event = makeTurnEvent(
      sessionId,
      `${turn}`,
      `${JSON.stringify(payload)}`,
    );
    console.log(formatEvent(event));

    return {
      id: request.id,
      command: request.command,
      status: "ok",
      result: payload,
    };
  }

  if (request.command === "bash") {
    const payload = request.payload as {
      command?: string;
      sandboxMode?: SandboxMode;
    };
    return {
      id: request.id,
      command: request.command,
      status: "ok",
      result: {
        sessionId,
        accepted: Boolean(payload?.command),
        sandboxMode: payload?.sandboxMode ?? sandboxMode,
      },
    };
  }

  if (
    request.command === "steer"
    || request.command === "followUp"
    || request.command === "follow_up"
  ) {
    return {
      id: request.id,
      command: request.command,
      status: "ok",
      result: {
        sessionId,
        command: request.command,
        queued: true,
      },
    };
  }

  if (request.command === "get_state") {
    return {
      id: request.id,
      command: request.command,
      status: "ok",
      result: {
        sessionId,
        busy: false,
        queued: 0,
        sandboxMode,
      },
    };
  }

  if (request.command === "get_messages") {
    return {
      id: request.id,
      command: request.command,
      status: "ok",
      result: {
        sessionId,
        messages: [],
      },
    };
  }

  return {
    id: request.id,
    command: request.command,
    status: "error",
    error: `unsupported command: ${request.command}`,
  };
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
