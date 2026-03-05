import { expect, test, describe, mock, beforeEach } from "bun:test";
import { InMemoryPodManager, createPodManager, type PodCommandRunner, type PodConfig } from "../../packages/pods/src/index.js";

describe("InMemoryPodManager", () => {
  let mockRunner: PodCommandRunner;
  let manager: InMemoryPodManager;
  let runMock: ReturnType<typeof mock>;

  const validConfig: PodConfig = {
    name: "test-pod",
    provider: "test-provider",
    sshHost: "192.168.1.100",
  };

  beforeEach(() => {
    runMock = mock(async (command: string) => ({
      stdout: "success",
      stderr: "",
      exitCode: 0,
    }));

    mockRunner = {
      run: runMock
    };

    manager = new InMemoryPodManager({ commandRunner: mockRunner });
  });

  describe("setup and getPodConfig", () => {
    test("initializes config with defaults when not provided", async () => {
      await manager.setup(validConfig);
      const config = await manager.getPodConfig();
      expect(config).toEqual({
        name: "test-pod",
        provider: "test-provider",
        sshHost: "192.168.1.100",
        contextWindow: 8192,
        gpuMemoryGb: 24,
      });
    });

    test("initializes config with provided values", async () => {
      await manager.setup({
        ...validConfig,
        contextWindow: 4096,
        gpuMemoryGb: 16,
      });
      const config = await manager.getPodConfig();
      expect(config?.contextWindow).toBe(4096);
      expect(config?.gpuMemoryGb).toBe(16);
    });

    test("getPodConfig returns null before setup", async () => {
      const config = await manager.getPodConfig();
      expect(config).toBeNull();
    });

    test("getPodConfig returns a copy of the config", async () => {
      await manager.setup(validConfig);
      const config1 = await manager.getPodConfig();
      const config2 = await manager.getPodConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  describe("startModel", () => {
    test("throws error if pod not configured", async () => {
      await expect(manager.startModel("test-model")).rejects.toThrow("pod not configured");
    });

    test("executes command runner and adds model to activeModels on success", async () => {
      await manager.setup(validConfig);
      await manager.startModel("test-model");

      expect(runMock).toHaveBeenCalledTimes(1);
      expect(runMock.mock.calls[0][0]).toContain("test-model");

      const models = await manager.listModels();
      expect(models).toEqual(["test-model"]);
    });

    test("throws error if command runner fails", async () => {
      await manager.setup(validConfig);
      runMock.mockImplementationOnce(async () => ({
        stdout: "",
        stderr: "custom error",
        exitCode: 1,
      }));

      await expect(manager.startModel("test-model")).rejects.toThrow("start model failed: custom error");

      const models = await manager.listModels();
      expect(models).toEqual([]);
    });

    test("uses stdout in error message if stderr is empty on failure", async () => {
      await manager.setup(validConfig);
      runMock.mockImplementationOnce(async () => ({
        stdout: "custom stdout error",
        stderr: "",
        exitCode: 1,
      }));

      await expect(manager.startModel("test-model")).rejects.toThrow("start model failed: custom stdout error");
    });
  });

  describe("stopModel", () => {
    test("throws error if pod not configured", async () => {
      await expect(manager.stopModel("test-model")).rejects.toThrow("pod not configured");
    });

    test("removes model from activeModels", async () => {
      await manager.setup(validConfig);
      await manager.startModel("test-model");
      await manager.startModel("test-model-2");

      await manager.stopModel("test-model");

      const models = await manager.listModels();
      expect(models).toEqual(["test-model-2"]);
    });

    test("does not throw if stopping a model that isn't running", async () => {
      await manager.setup(validConfig);
      await manager.stopModel("non-existent-model");
      // If it doesn't throw, the test passes
    });
  });

  describe("listModels", () => {
    test("returns empty array initially", async () => {
      const models = await manager.listModels();
      expect(models).toEqual([]);
    });

    test("returns active models in insertion order", async () => {
      await manager.setup(validConfig);
      await manager.startModel("model-a");
      await manager.startModel("model-b");

      const models = await manager.listModels();
      expect(models).toEqual(["model-a", "model-b"]);
    });
  });

  describe("getEndpoint", () => {
    test("throws error if pod not configured", () => {
      expect(() => manager.getEndpoint("test-model")).toThrow("pod not configured");
    });

    test("returns correctly formatted URL with URL-encoded model ID", async () => {
      await manager.setup(validConfig);
      const url = manager.getEndpoint("test model/with/slashes");
      expect(url).toBe("http://192.168.1.100:11434/v1/models/test%20model%2Fwith%2Fslashes");
    });
  });

  describe("renderStartCommand", () => {
    test("throws error if pod not configured", () => {
      expect(() => manager.renderStartCommand("test-model")).toThrow("pod not configured");
    });

    test("returns formatted vllm start command", async () => {
      await manager.setup(validConfig);
      const command = manager.renderStartCommand("test-model");
      expect(command).toBe('python3 -m vllm.entrypoints.openai.api_server --model "test-model" --host 0.0.0.0 --port 11434 --max-num-seqs 32');
    });
  });

  describe("createPodManager", () => {
    test("creates manager with provided runner", async () => {
      const newManager = createPodManager(mockRunner);
      await newManager.setup(validConfig);
      await newManager.startModel("test");
      expect(runMock).toHaveBeenCalled();
    });

    test("creates manager with default runner when no runner provided", () => {
      const newManager = createPodManager();
      expect(newManager).toBeInstanceOf(InMemoryPodManager);
    });
  });
});
