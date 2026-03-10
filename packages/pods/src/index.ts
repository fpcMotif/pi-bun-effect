import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
  start(modelId: string): Promise<void>;
  stop(modelId: string): Promise<void>;
  list(): Promise<string[]>;
  logs(modelId: string): Promise<string>;
  startModel(modelId: string): Promise<void>;
  stopModel(modelId: string): Promise<void>;
  listModels(): Promise<string[]>;
  getEndpoint(modelId: string): string;
  renderSetupCommand(config: PodConfig): string;
  renderStartCommand(modelId: string): string;
  renderStopCommand(modelId: string): string;
  renderLogsCommand(modelId: string): string;
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

interface PersistedState {
  podConfig: PodConfig | null;
  activeModels: string[];
}

function defaultRunner(command: string): Promise<CommandResult> {
  if (typeof Bun === "undefined") {
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
  }
  const process = Bun.spawnSync(["sh", "-c", command]);
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
      statePath?: string;
    } = {},
  ) {}

  async setup(config: PodConfig): Promise<void> {
    this.podConfig = {
      name: config.name,
      provider: config.provider,
      sshHost: config.sshHost,
      contextWindow: config.contextWindow ?? 8192,
      gpuMemoryGb: config.gpuMemoryGb ?? 24,
    };
    await this.runAndCheck(this.renderSetupCommand(this.podConfig));
    await this.persistState();
  }

  async start(modelId: string): Promise<void> {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    await this.runAndCheck(this.renderStartCommand(modelId));
    this.activeModels.add(modelId);
    await this.persistState();
  }

  async stop(modelId: string): Promise<void> {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    await this.runAndCheck(this.renderStopCommand(modelId));
    this.activeModels.delete(modelId);
    await this.persistState();
  }

  async list(): Promise<string[]> {
    await this.loadState();
    return Array.from(this.activeModels.values());
  }

  async logs(modelId: string): Promise<string> {
    const result = await this.runAndCheck(this.renderLogsCommand(modelId));
    return result.stdout;
  }

  async startModel(modelId: string): Promise<void> {
    return this.start(modelId);
  }

  async stopModel(modelId: string): Promise<void> {
    return this.stop(modelId);
  }

  async listModels(): Promise<string[]> {
    return this.list();
  }

  async getPodConfig(): Promise<PodConfig | null> {
    await this.loadState();
    return this.podConfig ? { ...this.podConfig } : null;
  }

  getEndpoint(modelId: string): string {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    return `http://${this.podConfig.sshHost}:11434/v1/models/${encodeURIComponent(modelId)}`;
  }

  renderSetupCommand(config: PodConfig): string {
    return `echo setup:${JSON.stringify(config.name)} provider:${JSON.stringify(config.provider)}`;
  }

  renderStartCommand(modelId: string): string {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    return `python3 -m vllm.entrypoints.openai.api_server --model ${JSON.stringify(modelId)} --host 0.0.0.0 --port 11434 --max-num-seqs 32`;
  }

  renderStopCommand(modelId: string): string {
    return `pkill -f ${JSON.stringify(modelId)}`;
  }

  renderLogsCommand(modelId: string): string {
    return `echo logs-for:${JSON.stringify(modelId)}`;
  }

  private async runAndCheck(command: string): Promise<CommandResult> {
    const runner = this.options.commandRunner ?? { run: defaultRunner };
    let result: CommandResult;
    try {
      result = await runner.run(command);
    } catch (error) {
      throw new Error(`command execution failed: ${command}; ${(error as Error).message}`);
    }

    const normalized = {
      stdout: result.stdout?.trim() ?? "",
      stderr: result.stderr?.trim() ?? "",
      exitCode: result.exitCode,
    };

    if (normalized.exitCode !== 0) {
      const detail = normalized.stderr || normalized.stdout || "unknown error";
      throw new Error(`command failed (${normalized.exitCode}): ${command}; ${detail}`);
    }

    return normalized;
  }

  private getStatePath(): string {
    return this.options.statePath ?? ".pi/pods/state.json";
  }

  private async persistState(): Promise<void> {
    const path = this.getStatePath();
    await mkdir(dirname(path), { recursive: true });
    const payload: PersistedState = {
      podConfig: this.podConfig,
      activeModels: Array.from(this.activeModels),
    };
    await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
  }

  private async loadState(): Promise<void> {
    if (this.podConfig || this.activeModels.size > 0) {
      return;
    }
    const path = this.getStatePath();
    const raw = await readFile(path, "utf8").catch(() => "");
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as PersistedState;
    this.podConfig = parsed.podConfig;
    for (const model of parsed.activeModels ?? []) {
      this.activeModels.add(model);
    }
  }
}

export function createPodManager(commandRunner?: PodCommandRunner): PodManager {
  return new InMemoryPodManager(commandRunner ? { commandRunner } : {});
}
