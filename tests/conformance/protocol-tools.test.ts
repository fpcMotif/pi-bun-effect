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
