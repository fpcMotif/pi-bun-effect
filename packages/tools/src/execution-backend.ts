export type SandboxMode = "local" | "subprocess-isolated" | "containerized";

export interface ExecutionRequest {
  command: string;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  mode: SandboxMode;
}

export interface ExecutionBackend {
  readonly mode: SandboxMode;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

class LocalExecutionBackend implements ExecutionBackend {
  readonly mode: SandboxMode = "local";

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (typeof Bun === "undefined") {
      return {
        stdout: `mock-run:${request.command}`,
        stderr: "",
        exitCode: 0,
        mode: this.mode,
      };
    }

    const childProcess = Bun.spawnSync(["sh", "-c", request.command]);
    return {
      stdout: childProcess.stdout.toString(),
      stderr: childProcess.stderr.toString(),
      exitCode: childProcess.exitCode,
      mode: this.mode,
    };
  }
}

class SubprocessIsolatedExecutionBackend implements ExecutionBackend {
  readonly mode: SandboxMode = "subprocess-isolated";

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    if (typeof Bun === "undefined") {
      return {
        stdout: `[subprocess-isolated] mock-run:${request.command}`,
        stderr: "",
        exitCode: 0,
        mode: this.mode,
      };
    }

    const childProcess = Bun.spawnSync(["env", "-i", "sh", "-c", request.command], {
      env: {
        PATH: process.env.PATH,
      },
    });

    return {
      stdout: childProcess.stdout.toString(),
      stderr: childProcess.stderr.toString(),
      exitCode: childProcess.exitCode,
      mode: this.mode,
    };
  }
}

class ContainerizedExecutionBackend implements ExecutionBackend {
  readonly mode: SandboxMode = "containerized";

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return {
      stdout: "",
      stderr:
        `containerized sandbox backend is not available for command: ${request.command}`,
      exitCode: 126,
      mode: this.mode,
    };
  }
}

export function createExecutionBackend(mode: SandboxMode): ExecutionBackend {
  switch (mode) {
    case "subprocess-isolated":
      return new SubprocessIsolatedExecutionBackend();
    case "containerized":
      return new ContainerizedExecutionBackend();
    case "local":
    default:
      return new LocalExecutionBackend();
  }
}
