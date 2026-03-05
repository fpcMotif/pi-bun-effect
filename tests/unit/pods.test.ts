import { expect, test } from "bun:test";
import { InMemoryPodManager, type PodConfig, type PodCommandRunner } from "../../packages/pods/src/index";

test("startModel throws error when pod is not configured", async () => {
  const manager = new InMemoryPodManager();
  await expect(manager.startModel("test-model")).rejects.toThrow(
    "pod not configured",
  );
});

test("startModel succeeds when pod is configured", async () => {
  const mockRunner: PodCommandRunner = {
    run: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
  };
  const manager = new InMemoryPodManager({ commandRunner: mockRunner });

  const config: PodConfig = {
    name: "test-pod",
    provider: "test-provider",
    sshHost: "localhost",
  };

  await manager.setup(config);
  await expect(manager.startModel("test-model")).resolves.toBeUndefined();

  const models = await manager.listModels();
  expect(models).toContain("test-model");
});
