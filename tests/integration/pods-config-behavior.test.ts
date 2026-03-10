import { InMemoryPodManager, type PodCommandRunner } from "../../packages/pods/src/index";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("integration: pods persists config, endpoint, lifecycle, and logs", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-pods-"));
  const commands: string[] = [];
  const runner: PodCommandRunner = {
    async run(command) {
      commands.push(command);
      return { stdout: `ok:${command}`, stderr: "", exitCode: 0 };
    },
  };

  const manager = new InMemoryPodManager({
    commandRunner: runner,
    statePath: join(root, "state.json"),
  });

  await manager.setup({ name: "gpu-a", provider: "runpod", sshHost: "10.0.0.2" });
  await manager.start("meta-llama/Llama-3.1-8B-Instruct");

  expect(await manager.list()).toHaveLength(1);
  expect(manager.getEndpoint("meta-llama/Llama-3.1-8B-Instruct")).toContain("10.0.0.2");
  expect(await manager.logs("meta-llama/Llama-3.1-8B-Instruct")).toContain("logs-for");

  const reloaded = new InMemoryPodManager({
    commandRunner: runner,
    statePath: join(root, "state.json"),
  });
  expect((await reloaded.getPodConfig())?.name).toBe("gpu-a");
  expect(await reloaded.listModels()).toEqual(["meta-llama/Llama-3.1-8B-Instruct"]);

  await reloaded.stopModel("meta-llama/Llama-3.1-8B-Instruct");
  expect(await reloaded.listModels()).toHaveLength(0);
  expect(commands.some((command) => command.includes("pkill"))).toBeTrue();
});
