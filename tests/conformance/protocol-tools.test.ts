import type { AgentMessage } from "@pi-bun-effect/core";
import type { Capability, TrustDecision } from "@pi-bun-effect/extensions";
import type { RpcPayloads, RpcRequest } from "@pi-bun-effect/rpc";
import { createRpcProtocol } from "@pi-bun-effect/rpc";
import { createToolRegistry, registerBuiltinTools } from "@pi-bun-effect/tools";
import type { ToolContext } from "@pi-bun-effect/tools";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcExecutionService } from "../../packages/cli/src/index";

function userMessage(text: string): AgentMessage {
  return {
    type: "user",
    role: "user",
    id: `c-${text}`,
    timestamp: new Date().toISOString(),
    content: [{ type: "text", text }],
  };
}

const protocol = createRpcProtocol();

test("conformance: rpc protocol preserves command ids and payload shapes", () => {
  const request: RpcRequest = protocol.parseLine(
    JSON.stringify({
      id: "rpc-corr-1",
      command: "prompt",
      payload: {
        message: userMessage("baseline"),
        mode: "json",
      } satisfies RpcPayloads & { message: AgentMessage },
    }),
  ) as RpcRequest;

  expect(request.id).toBe("rpc-corr-1");
  expect(request.command).toBe("prompt");
  expect(request.payload).toBeDefined();
  expect((request.payload as { message?: unknown } | undefined)?.message)
    .toBeDefined();
});

test("conformance: rpc protocol rejects malformed and unknown commands", () => {
  expect(protocol.parseLine("{invalid")).toBeNull();
  expect(protocol.parseLine("{\"id\":\"x\",\"command\":\"unknown\"}"))
    .toBeNull();
  expect(
    protocol.parseLine("{\"id\":123,\"command\":\"prompt\",\"payload\":null}"),
  ).toBeNull();
});

test("conformance: rpc p0 commands are implemented with correlated response envelopes", async () => {
  const sessionsRoot = mkdtempSync(
    join(tmpdir(), "pi-bun-effect-rpc-conformance-"),
  );
  const service = await createRpcExecutionService({ rootDir: sessionsRoot });

  const promptResponse = await service.handle({
    id: "p0-prompt",
    command: "prompt",
    payload: { message: userMessage("hello") },
  });
  expect(promptResponse).toMatchObject({
    id: "p0-prompt",
    command: "prompt",
    status: "ok",
  });

  const availableModels = await service.handle({
    id: "p0-get-models",
    command: "get_available_models",
  });
  expect(availableModels.id).toBe("p0-get-models");
  expect(availableModels.command).toBe("get_available_models");
  expect(availableModels.status).toBe("ok");
  expect((availableModels.result as { models: unknown[] }).models.length)
    .toBeGreaterThan(0);

  const setModel = await service.handle({
    id: "p0-set-model",
    command: "set_model",
    payload: { provider: "openai", modelId: "gpt-4o" },
  });
  expect(setModel).toMatchObject({
    id: "p0-set-model",
    command: "set_model",
    status: "ok",
  });

  const cycleModel = await service.handle({
    id: "p0-cycle-model",
    command: "cycle_model",
  });
  expect(cycleModel).toMatchObject({
    id: "p0-cycle-model",
    command: "cycle_model",
    status: "ok",
  });

  const compact = await service.handle({
    id: "p0-compact",
    command: "compact",
  });
  expect(compact).toMatchObject({
    id: "p0-compact",
    command: "compact",
    status: "ok",
  });

  const setAutoRetry = await service.handle({
    id: "p0-set-auto-retry",
    command: "set_auto_retry",
    payload: { enabled: true },
  });
  expect(setAutoRetry).toMatchObject({
    id: "p0-set-auto-retry",
    command: "set_auto_retry",
    status: "ok",
  });

  const abortRetry = await service.handle({
    id: "p0-abort-retry",
    command: "abort_retry",
  });
  expect(abortRetry).toMatchObject({
    id: "p0-abort-retry",
    command: "abort_retry",
    status: "ok",
  });

  const bash = await service.handle({
    id: "p0-bash",
    command: "bash",
    payload: { command: "printf 'rpc-bash-ok'" },
  });
  expect(bash).toMatchObject({ id: "p0-bash", command: "bash", status: "ok" });

  const newSession = await service.handle({
    id: "p0-new-session",
    command: "new_session",
  });
  expect(newSession).toMatchObject({
    id: "p0-new-session",
    command: "new_session",
    status: "ok",
  });
  const switchedSessionId =
    (newSession.result as { sessionId: string }).sessionId;

  const switched = await service.handle({
    id: "p0-switch",
    command: "switch",
    payload: { sessionId: switchedSessionId },
  });
  expect(switched).toMatchObject({
    id: "p0-switch",
    command: "switch",
    status: "ok",
  });

  const prompt2 = await service.handle({
    id: "p0-prompt-2",
    command: "prompt",
    payload: { message: userMessage("branchable") },
  });
  expect(prompt2.status).toBe("ok");

  const messages = await service.handle({
    id: "p0-get-messages",
    command: "get_messages",
  });
  expect(messages.status).toBe("ok");
  const messageList =
    (messages.result as { messages: AgentMessage[] }).messages;
  const forkSource = messageList.at(-1)?.id;
  expect(forkSource).toBeDefined();

  const fork = await service.handle({
    id: "p0-fork",
    command: "fork",
    payload: { entryId: forkSource },
  });
  expect(fork).toMatchObject({ id: "p0-fork", command: "fork", status: "ok" });

  const tree = await service.handle({
    id: "p0-tree",
    command: "tree_navigation",
    payload: {
      action: "linearize",
      entryId: (fork.result as { forkedEntryId: string }).forkedEntryId,
    },
  });
  expect(tree).toMatchObject({
    id: "p0-tree",
    command: "tree_navigation",
    status: "ok",
  });

  rmSync(sessionsRoot, { recursive: true, force: true });
});

test("conformance: builtin tools satisfy read/write/edit/bash contracts", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-conformance-"));
  const target = join(root, "payload.txt");
  writeFileSync(target, "seed");

  const registry = createToolRegistry();
  registerBuiltinTools(registry);

  const trust: TrustDecision = "trusted";

  const context: ToolContext = {
    sandboxRoot: root,
    sessionId: "conformance-session",
    extensionId: "ext-conformance",
    capabilities: new Set<Capability>([
      "tool:read",
      "tool:write",
      "tool:edit",
      "tool:bash",
    ]),
    trust,
  };

  const readResult = await registry.execute(context, {
    name: "read",
    input: { path: target },
  });
  const readText = readResult.content.content.at(0)?.text;
  expect(readText).toBe("seed");

  await registry.execute(context, {
    name: "write",
    input: { path: target, text: "seeded" },
  });

  const editedResult = await registry.execute(context, {
    name: "edit",
    input: { path: target, find: "seeded", replace: "final" },
  });
  expect(editedResult.content.type).toBe("toolResult");

  const readAfterEdit = await registry.execute(context, {
    name: "read",
    input: { path: target },
  });
  expect(readAfterEdit.content.content.at(0)?.text).toBe("final");

  const bashResult = await registry.execute(context, {
    name: "bash",
    input: { command: "printf 'ok'" },
  });
  const bashText = bashResult.content.content.at(0)?.text;
  expect(bashText).toContain("ok");

  rmSync(root, { recursive: true, force: true });
});
