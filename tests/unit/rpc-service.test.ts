import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcExecutionService } from "../../packages/cli/src/index";

function makeSessionsRoot(): string {
  return mkdtempSync(join(tmpdir(), "pi-bun-effect-rpc-unit-"));
}

test("rpc service rejects denied bash commands with correlated errors", async () => {
  const root = makeSessionsRoot();
  const service = await createRpcExecutionService({ rootDir: root });

  const response = await service.handle({
    id: "rpc-bash-denied",
    command: "bash",
    payload: { command: "rm -rf /tmp/test" },
  });

  expect(response).toMatchObject({
    id: "rpc-bash-denied",
    command: "bash",
    status: "error",
  });
  expect(response.error).toContain("Blocked by default safety pattern");
  rmSync(root, { recursive: true, force: true });
});

test("rpc service validates switch payloads", async () => {
  const root = makeSessionsRoot();
  const service = await createRpcExecutionService({ rootDir: root });

  const response = await service.handle({
    id: "rpc-switch-missing",
    command: "switch",
    payload: {},
  });

  expect(response).toMatchObject({
    id: "rpc-switch-missing",
    command: "switch",
    status: "error",
    error: "payload.sessionId is required",
  });
  rmSync(root, { recursive: true, force: true });
});

test("rpc service validates set_model payloads", async () => {
  const root = makeSessionsRoot();
  const service = await createRpcExecutionService({ rootDir: root });

  const response = await service.handle({
    id: "rpc-set-model-missing",
    command: "set_model",
    payload: { provider: "openai" },
  });

  expect(response).toMatchObject({
    id: "rpc-set-model-missing",
    command: "set_model",
    status: "error",
    error: "payload.provider and payload.modelId are required",
  });
  rmSync(root, { recursive: true, force: true });
});
