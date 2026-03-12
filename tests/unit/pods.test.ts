import { expect, test } from "bun:test";
import {
  type CommandResult,
  createPodManager,
  type PodCommandRunner,
} from "../../packages/pods/src/index.js";

test("pod manager startModel prevents command injection", async () => {
  let _executedCommand: string[] | null = null;

  const mockRunner: PodCommandRunner = {
    run: async (command: string[]): Promise<CommandResult> => {
      _executedCommand = command;
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
  await expect(manager.startModel(maliciousModelId)).rejects.toThrow(
    "Invalid model ID",
  );
});
