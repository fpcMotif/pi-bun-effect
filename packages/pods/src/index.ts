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
  startModel(modelId: string): Promise<void>;
  stopModel(modelId: string): Promise<void>;
  listModels(): Promise<string[]>;
  logs(modelId: string): Promise<string>;
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

export interface PodManagerOptions {
  commandRunner?: PodCommandRunner;
  configPath?: string;
  basePort?: number;
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

  constructor(private readonly options: PodManagerOptions = {}) {}

  private get commandRunner(): PodCommandRunner {
    return this.options.commandRunner ?? { run: defaultRunner };
  }

  private async persistConfig(config: PodConfig): Promise<void> {
    if (!this.options.configPath) {
      return;
    }
    await mkdir(dirname(this.options.configPath), { recursive: true });
    await writeFile(this.options.configPath, JSON.stringify(config, null, 2), "utf8");
  }

  private async loadConfig(): Promise<PodConfig | null> {
    if (!this.options.configPath) {
      return null;
    }
    try {
      const raw = await readFile(this.options.configPath, "utf8");
      return JSON.parse(raw) as PodConfig;
    } catch {
      return null;
    }
  }

  private async requireConfig(): Promise<PodConfig> {
    if (this.podConfig) {
      return this.podConfig;
    }
    const persisted = await this.loadConfig();
    if (!persisted) {
      throw new Error("pod not configured");
    }
    this.podConfig = persisted;
    return persisted;
  }

  private renderCommand(
    action: "setup" | "start" | "stop" | "list" | "logs",
    modelId?: string,
  ): string {
    const config = this.podConfig;
    if (!config) {
      throw new Error("pod not configured");
    }

    const escapedModelId = modelId ? JSON.stringify(modelId) : "";
    switch (action) {
      case "setup":
        return `ssh ${JSON.stringify(config.sshHost)} 'mkdir -p /opt/pi-bun-effect/models'`;
      case "start":
        return `ssh ${JSON.stringify(config.sshHost)} 'python3 -m vllm.entrypoints.openai.api_server --model ${escapedModelId} --host 0.0.0.0 --port 11434 --max-num-seqs 32'`;
      case "stop":
        return `ssh ${JSON.stringify(config.sshHost)} 'pkill -f ${escapedModelId} || true'`;
      case "list":
        return `ssh ${JSON.stringify(config.sshHost)} 'ls -1 /opt/pi-bun-effect/models || true'`;
      case "logs":
        return `ssh ${JSON.stringify(config.sshHost)} 'tail -n 200 /var/log/${escapedModelId}.log || true'`;
    }
  }

  async setup(config: PodConfig): Promise<void> {
    this.podConfig = {
      name: config.name,
      provider: config.provider,
      sshHost: config.sshHost,
      contextWindow: config.contextWindow ?? 8192,
      gpuMemoryGb: config.gpuMemoryGb ?? 24,
    };
    await this.persistConfig(this.podConfig);
    const result = await this.commandRunner.run(this.renderCommand("setup"));
    if (result.exitCode !== 0) {
      throw new Error(`pod setup failed: ${result.stderr || result.stdout}`);
    }
  }

  async startModel(modelId: string): Promise<void> {
    await this.requireConfig();
    const command = this.renderCommand("start", modelId);
    const result = await this.commandRunner.run(command);
    if (result.exitCode !== 0) {
      throw new Error(`start model failed: ${result.stderr || result.stdout}`);
    }
    this.activeModels.add(modelId);
  }

  async stopModel(modelId: string): Promise<void> {
    await this.requireConfig();
    const result = await this.commandRunner.run(this.renderCommand("stop", modelId));
    if (result.exitCode !== 0) {
      throw new Error(`stop model failed: ${result.stderr || result.stdout}`);
    }
    this.activeModels.delete(modelId);
  }

  async listModels(): Promise<string[]> {
    await this.requireConfig();
    const result = await this.commandRunner.run(this.renderCommand("list"));
    if (result.exitCode !== 0) {
      throw new Error(`list models failed: ${result.stderr || result.stdout}`);
    }
    const listed = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    listed.forEach((model) => this.activeModels.add(model));
    return Array.from(this.activeModels.values());
  }

  async logs(modelId: string): Promise<string> {
    await this.requireConfig();
    const result = await this.commandRunner.run(this.renderCommand("logs", modelId));
    if (result.exitCode !== 0) {
      throw new Error(`model logs failed: ${result.stderr || result.stdout}`);
    }
    return [result.stdout, result.stderr].filter((part) => part.length > 0).join("\n").trim();
  }

  async getPodConfig(): Promise<PodConfig | null> {
    if (this.podConfig) {
      return { ...this.podConfig };
    }
    const persisted = await this.loadConfig();
    if (persisted) {
      this.podConfig = persisted;
      return { ...persisted };
    }
    return null;
  }

  getEndpoint(modelId: string): string {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    return `http://${this.podConfig.sshHost}:${this.options.basePort ?? 11434}/v1/models/${encodeURIComponent(modelId)}`;
  }

  renderStartCommand(modelId: string): string {
    if (!this.podConfig) {
      throw new Error("pod not configured");
    }
    return this.renderCommand("start", modelId);
  }
}

export function createPodManager(options: PodManagerOptions = {}): PodManager {
  return new InMemoryPodManager(options);
}
