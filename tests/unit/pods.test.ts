import { expect, test } from "bun:test";
import {
  type CommandResult,
  createPodManager,
  type PodCommandRunner,
} from "../../packages/pods/src/index.js";

test("pod manager startModel prevents command injection", async () => {
  let executedCommand: string[] | null = null;

  const mockRunner: PodCommandRunner = {
    run: async (command: string[]): Promise<CommandResult> => {
      executedCommand = command;
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };

  const manager = createPodManager(mockRunner);

  await manager.setup({
    name: "test-pod",
    provider: "local",
    sshHost: "127.0.0.1",
  });

  const maliciousModelId = "model-name; cat /etc/passwd";
  await manager.startModel(maliciousModelId);

  expect(executedCommand).not.toBeNull();
  expect(executedCommand).toBeInstanceOf(Array);
  expect(executedCommand).toEqual([
    "python3",
    "-m",
    "vllm.entrypoints.openai.api_server",
    "--model",
    maliciousModelId,
    "--host",
    "0.0.0.0",
    "--port",
    "11434",
    "--max-num-seqs",
    "32",
  ]);
});
