import { createPodManager, type CommandResult, type PodCommandRunner } from "../../packages/pods/src/index";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

class StubRunner implements PodCommandRunner {
  readonly commands: string[] = [];

  async run(command: string): Promise<CommandResult> {
    this.commands.push(command);
    if (command.includes("ls -1")) {
      return { stdout: "llama3\n", stderr: "", exitCode: 0 };
    }
    if (command.includes("tail -n")) {
      return { stdout: "startup ok", stderr: "", exitCode: 0 };
    }
    return { stdout: "ok", stderr: "", exitCode: 0 };
  }
}

test("integration: pods manager orchestrates commands and persists config", async () => {
  const runner = new StubRunner();
  const root = mkdtempSync(join(tmpdir(), "pods-manager-"));
  const configPath = join(root, "pod-config.json");

  const manager = createPodManager({ commandRunner: runner, configPath, basePort: 12000 });

  await manager.setup({
    name: "gpu-a",
    provider: "runpod",
    sshHost: "10.0.0.2",
  });
  await manager.startModel("llama3");
  const listed = await manager.listModels();
  const logs = await manager.logs("llama3");
  await manager.stopModel("llama3");

  const persistedManager = createPodManager({ commandRunner: runner, configPath, basePort: 12000 });
  const persisted = await persistedManager.getPodConfig();

  expect(runner.commands.some((command) => command.includes("mkdir -p"))).toBeTrue();
  expect(runner.commands.some((command) => command.includes("api_server"))).toBeTrue();
  expect(runner.commands.some((command) => command.includes("pkill"))).toBeTrue();
  expect(listed).toContain("llama3");
  expect(logs).toContain("startup ok");
  expect(persisted?.sshHost).toBe("10.0.0.2");
  expect(manager.getEndpoint("llama3")).toBe("http://10.0.0.2:12000/v1/models/llama3");
});
