import {
  createRpcCommandDispatcher,
  createRpcProtocol,
  type RpcRequest,
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
    const dispatcher = createRpcCommandDispatcher({
      onEvent: (event) => {
        console.log(protocol.encodeEvent(event));
      },
    });

    const raw = await new Response(Bun.stdin).text();
    const lines = raw.split(/\r?\n/);

    for (const rawLine of lines) {
      const request = protocol.parseLine(rawLine) as RpcRequest | null;
      if (!request) {
        continue;
      }
      const response = await dispatcher.dispatch(request);
      console.log(protocol.encodeResponse(response));
      if (request.command === "abort") {
        break;
      }
    }

    await dispatcher.waitForQueue();
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
  };
  console.log(formatEvent(fallback));
  return 0;
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
