import { describe, expect, it } from "bun:test";
import {
  CommandResult,
  InMemoryPodManager,
  PodCommandRunner,
  validateModelId,
} from "../../src/index.js";

describe("validateModelId", () => {
  it("allows valid model IDs", () => {
    expect(validateModelId("llama3-8b")).toBe("llama3-8b");
    expect(validateModelId("deepseek-coder:33b")).toBe("deepseek-coder:33b");
    expect(validateModelId("gpt-4/latest")).toBe("gpt-4/latest");
    expect(validateModelId("my_custom_model.bin")).toBe("my_custom_model.bin");
  });

  it("throws on invalid shell characters", () => {
    expect(() => validateModelId("llama3; rm -rf /")).toThrow(
      "Invalid model ID",
    );
    expect(() => validateModelId("deepseek$(whoami)")).toThrow(
      "Invalid model ID",
    );
    expect(() => validateModelId("model_name && echo 'pwned'")).toThrow(
      "Invalid model ID",
    );
    expect(() => validateModelId("model|grep pwned")).toThrow(
      "Invalid model ID",
    );
  });
});

describe("InMemoryPodManager", () => {
  const validConfig = {
    name: "test-pod",
    provider: "local",
    sshHost: "localhost",
  };

  it("starts model successfully with valid ID", async () => {
    let commandRun = "";
    const mockRunner: PodCommandRunner = {
      run: async (command: string): Promise<CommandResult> => {
        commandRun = command;
        return { stdout: "started", stderr: "", exitCode: 0 };
      },
    };

    const manager = new InMemoryPodManager({ commandRunner: mockRunner });
    await manager.setup(validConfig);

    await expect(manager.startModel("valid-model-1.0")).resolves
      .toBeUndefined();
    expect(commandRun).toContain("valid-model-1.0");
  });

  it("fails to start model with injection characters in ID", async () => {
    let commandRun = "";
    const mockRunner: PodCommandRunner = {
      run: async (command: string): Promise<CommandResult> => {
        commandRun = command;
        return { stdout: "started", stderr: "", exitCode: 0 };
      },
    };

    const manager = new InMemoryPodManager({ commandRunner: mockRunner });
    await manager.setup(validConfig);

    await expect(manager.startModel("invalid; injection")).rejects.toThrow(
      "Invalid model ID",
    );
    expect(commandRun).toBe(""); // Ensure command runner was never called
  });
});
