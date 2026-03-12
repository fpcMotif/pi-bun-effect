import {
  type CommandResult,
  createPodManager,
  InMemoryPodManager,
  type PodCommandRunner,
  type PodConfig,
} from "@pi-bun-effect/pods";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

describe("InMemoryPodManager", () => {
  const validConfig: PodConfig = {
    name: "test-pod",
    provider: "test-provider",
    sshHost: "192.168.1.100",
  };

  let runMock: ReturnType<typeof mock>;
  let mockRunner: PodCommandRunner;
  let manager: InMemoryPodManager;

  beforeEach(() => {
    runMock = mock(async (_command: string): Promise<CommandResult> => ({
      stdout: "success",
      stderr: "",
      exitCode: 0,
    }));

    mockRunner = { run: runMock };
    manager = new InMemoryPodManager({ commandRunner: mockRunner });
  });

  afterEach(() => {
    mock.restore();
  });

  test("startModel throws when the pod is not configured", async () => {
    await expect(manager.startModel("test-model")).rejects.toThrow(
      "pod not configured",
    );
  });

  test("setup stores config defaults and getPodConfig returns a copy", async () => {
    await manager.setup(validConfig);

    const configA = await manager.getPodConfig();
    const configB = await manager.getPodConfig();

    expect(configA).toEqual({
      name: "test-pod",
      provider: "test-provider",
      sshHost: "192.168.1.100",
      contextWindow: 8192,
      gpuMemoryGb: 24,
    });
    expect(configA).not.toBe(configB);
  });

  test("startModel uses the injected command runner and tracks active models", async () => {
    await manager.setup(validConfig);
    await manager.startModel("test-model");

    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0]?.[0]).toContain("\"test-model\"");
    expect(await manager.listModels()).toEqual(["test-model"]);
  });

  test("startModel surfaces runner failures from stderr or stdout", async () => {
    await manager.setup(validConfig);
    runMock.mockImplementationOnce(async () => ({
      stdout: "",
      stderr: "runner failed",
      exitCode: 1,
    }));

    await expect(manager.startModel("test-model")).rejects.toThrow(
      "start model failed: runner failed",
    );
  });

  test("startModel throws error for malicious modelId inputs", async () => {
    await manager.setup(validConfig);
    const maliciousModelId = "bad\"; touch /tmp/pwned #";
    await expect(manager.startModel(maliciousModelId)).rejects.toThrow(
      "Invalid model ID",
    );
  });

  test("internal argv builder keeps model ids as a single argument", async () => {
    const defaultManager = new InMemoryPodManager();
    await defaultManager.setup(validConfig);

    const injectedModelId = "bad\"; touch /tmp/pwned #";
    const args = (defaultManager as unknown as {
      buildStartArgs(modelId: string): string[];
    }).buildStartArgs(injectedModelId);

    expect(args).toContain("--model");
    expect(args).toContain(injectedModelId);
    expect(args.filter((value) => value === injectedModelId)).toHaveLength(1);
  });

  test("renderStartCommand remains a quoted display string", async () => {
    await manager.setup(validConfig);
    const command = manager.renderStartCommand("test-model");
    expect(command).toBe(
      "python3 -m vllm.entrypoints.openai.api_server --model \"test-model\" --host 0.0.0.0 --port 11434 --max-num-seqs 32",
    );
  });

  test("getEndpoint url-encodes the model id", async () => {
    await manager.setup(validConfig);
    expect(manager.getEndpoint("test model/with/slashes")).toBe(
      "http://192.168.1.100:11434/v1/models/test%20model%2Fwith%2Fslashes",
    );
  });

  test("createPodManager returns an InMemoryPodManager", () => {
    expect(createPodManager()).toBeInstanceOf(InMemoryPodManager);
  });
});
