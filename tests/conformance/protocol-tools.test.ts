import type { AgentMessage } from "@pi-bun-effect/core";
import type { Capability, TrustDecision } from "@pi-bun-effect/extensions";
import type { RpcCommandName, RpcPayloads, RpcRequest, RpcResponse } from "@pi-bun-effect/rpc";
import { createRpcProtocol } from "@pi-bun-effect/rpc";
import { createToolRegistry, registerBuiltinTools } from "@pi-bun-effect/tools";
import type { ToolContext } from "@pi-bun-effect/tools";
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("conformance: rpc protocol parses all required command names", () => {
  const commands: RpcCommandName[] = [
    "prompt",
    "steer",
    "followUp",
    "follow_up",
    "abort",
    "get_state",
    "get_messages",
    "set_model",
    "cycle_model",
    "get_available_models",
    "set_thinking_level",
    "cycle_thinking_level",
    "set_steering_mode",
    "set_follow_up_mode",
    "compact",
    "set_auto_compaction",
    "set_auto_retry",
    "abort_retry",
    "bash",
    "new_session",
    "switch",
    "fork",
    "tree_navigation",
  ];

  commands.forEach((command) => {
    const parsed = protocol.parseLine(
      JSON.stringify({ id: `rpc-${command}`, command, payload: {} }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(`rpc-${command}`);
    expect(parsed?.command).toBe(command);
  });
});

test("conformance: rpc protocol keeps correlation ids when encoding responses", () => {
  const response: RpcResponse = {
    id: "rpc-corr-2",
    command: "set_auto_retry",
    status: "error",
    error: "invalid_payload",
    result: {
      error: {
        code: "invalid_payload",
        correlationId: "rpc-corr-2",
      },
    },
  };

  const encoded = protocol.encodeResponse(response);
  const decoded = JSON.parse(encoded) as RpcResponse & {
    result?: { error?: { correlationId?: string } };
  };

  expect(decoded.id).toBe("rpc-corr-2");
  expect(decoded.result?.error?.correlationId).toBe("rpc-corr-2");
});

test("conformance: rpc protocol rejects malformed and unknown commands", () => {
  expect(protocol.parseLine("{invalid")).toBeNull();
  expect(protocol.parseLine("{\"id\":\"x\",\"command\":\"unknown\"}"))
    .toBeNull();
  expect(
    protocol.parseLine("{\"id\":123,\"command\":\"prompt\",\"payload\":null}"),
  ).toBeNull();
});

test("conformance: builtin tools satisfy read/write/edit/bash contracts", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-conformance-"));
  const target = join(root, "payload.txt");
  writeFileSync(target, "seed");

  const registry = createToolRegistry();
  registerBuiltinTools(registry);

  const trust: TrustDecision = "trusted";

  const context: ToolContext = {
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
