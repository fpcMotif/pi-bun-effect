export interface PodConfig {
  name: string;
  provider: string;
  sshHost: string;
  contextWindow?: number;
  gpuMemoryGb?: number;
}

export interface ManagedPod extends PodConfig {
  runningModels: string[];
}

export interface PodManager {
  setup(config: PodConfig): Promise<void>;
  startModel(modelId: string): Promise<void>;
  stopModel(modelId: string): Promise<void>;
  listModels(): Promise<string[]>;
  getEndpoint(modelId: string): string;
  renderStartCommand(modelId: string): string;
  getPodConfig(): Promise<PodConfig | null>;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PodCommandRunner {
  run(command: string): Promise<CommandResult>;
}

const VALID_HOSTNAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function isValidHostname(host: string): boolean {
  return VALID_HOSTNAME.test(host) && host.length <= 253;
}

function defaultRunner(command: string[]): Promise<CommandResult> {
  if (typeof Bun === "undefined") {
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
  }
  const process = Bun.spawnSync(command);
  return Promise.resolve({
    stdout: process.stdout.toString(),
    stderr: process.stderr.toString(),
    exitCode: process.exitCode,
  });
}

export class InMemoryPodManager implements PodManager {
  private podConfig: PodConfig | null = null;
  private readonly activeModels = new Set<string>();

  constructor(
    private readonly options: {
      commandRunner?: PodCommandRunner;
      basePort?: number;
    } = {},
  ) {}

  async setup(config: PodConfig): Promise<void> {
    if (!isValidHostname(config.sshHost)) {
      throw new Error(`Invalid SSH host: ${config.sshHost}`);
    }
    this.podConfig = {
      name: config.name,
      provider: config.provider,
      sshHost: config.sshHost,
      contextWindow: config.contextWindow ?? 8192,
      gpuMemoryGb: config.gpuMemoryGb ?? 24,
    };
  }

  private validateModelId(modelId: string): string {
    const safeModelId = modelId.replace(/[^a-zA-Z0-9._:/-]/g, "");
    if (!safeModelId || safeModelId !== modelId) {
      throw new Error(`Invalid model ID: ${modelId}`);
    }
    return safeModelId;
  }

  async startModel(modelId: string): Promise<void> {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    const safeModelId = this.validateModelId(modelId);
    const result = this.options.commandRunner
      ? await this.options.commandRunner.run(
        this.renderStartCommand(safeModelId),
      )
      : await defaultRunner(this.buildStartArgs(safeModelId));
    if (result.exitCode !== 0) {
      throw new Error(`start model failed: ${result.stderr || result.stdout}`);
    }
    this.activeModels.add(modelId);
  }

  async stopModel(modelId: string): Promise<void> {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    this.activeModels.delete(modelId);
  }

  async listModels(): Promise<string[]> {
    return Array.from(this.activeModels.values());
  }

  getPodConfig(): Promise<PodConfig | null> {
    return Promise.resolve(this.podConfig ? { ...this.podConfig } : null);
  }

  getEndpoint(modelId: string): string {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    return `http://${this.podConfig.sshHost}:11434/v1/models/${
      encodeURIComponent(modelId)
    }`;
  }

  renderStartCommand(modelId: string): string {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    const safeModelId = this.validateModelId(modelId);
    return [
      "python3",
      "-m",
      "vllm.entrypoints.openai.api_server",
      "--model",
      JSON.stringify(safeModelId),
      "--host",
      "0.0.0.0",
      "--port",
      "11434",
      "--max-num-seqs",
      "32",
    ].join(" ");
  }

  private buildStartArgs(modelId: string): string[] {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }

    return [
      "python3",
      "-m",
      "vllm.entrypoints.openai.api_server",
      "--model",
      modelId,
      "--host",
      "0.0.0.0",
      "--port",
      "11434",
      "--max-num-seqs",
      "32",
    ];
  }
}

export function createPodManager(commandRunner?: PodCommandRunner): PodManager {
  return new InMemoryPodManager(commandRunner ? { commandRunner } : {});
}
