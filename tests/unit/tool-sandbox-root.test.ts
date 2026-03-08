import type { AgentMessage, ToolResultMessageEntry } from "@pi-bun-effect/core";
import type { Capability, TrustDecision } from "@pi-bun-effect/extensions";
import {
  createToolRegistry,
  registerBuiltinTools,
  type ToolContext,
} from "@pi-bun-effect/tools";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

function makeContext(
  capabilities: Capability[],
  sandboxRoot: string,
  trust: TrustDecision = "trusted",
): ToolContext {
  return {
    sessionId: "sandbox-test",
    extensionId: "ext-sandbox",
    capabilities: new Set(capabilities),
    trust,
    sandboxRoot,
  };
}

function asToolResult(message: AgentMessage): ToolResultMessageEntry {
  expect(message.type).toBe("toolResult");
  return message as ToolResultMessageEntry;
}

describe("tool sandbox root enforcement", () => {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);

  let sandboxRoot = "";
  let siblingRoot = "";

  beforeAll(async () => {
    sandboxRoot = await mkdtemp(join(tmpdir(), "pi-bun-effect-sandbox-"));
    siblingRoot = `${sandboxRoot}-sibling`;
    await mkdir(siblingRoot, { recursive: true });
    await writeFile(join(sandboxRoot, "allowed.txt"), "allowed content");
    await writeFile(join(sandboxRoot, "needle.txt"), "needle in sandbox");
    await writeFile(join(siblingRoot, "secret.txt"), "outside secret");
  });

  afterAll(async () => {
    await rm(sandboxRoot, { recursive: true, force: true });
    await rm(siblingRoot, { recursive: true, force: true });
  });

  test("write succeeds within sandbox root", async () => {
    const context = makeContext(["tool:write"], sandboxRoot);
    const result = await registry.execute(context, {
      name: "write",
      input: { path: "output.txt", text: "sandbox ok" },
    });
    const toolResult = asToolResult(result.content);

    expect(toolResult.isError ?? false).toBeFalse();
    expect(await Bun.file(join(sandboxRoot, "output.txt")).text()).toBe(
      "sandbox ok",
    );
  });

  test("relative traversal outside sandbox returns tool error", async () => {
    const context = makeContext(["tool:write"], sandboxRoot);
    const result = await registry.execute(context, {
      name: "write",
      input: { path: "../outside.txt", text: "blocked" },
    });
    const toolResult = asToolResult(result.content);

    expect(toolResult.isError).toBeTrue();
    expect(toolResult.content.at(0)?.text).toContain(
      "Path traversal detected",
    );
  });

  test("absolute sibling escape returns tool error", async () => {
    const context = makeContext(["tool:write"], sandboxRoot);
    const result = await registry.execute(context, {
      name: "write",
      input: { path: join(siblingRoot, "sibling.txt"), text: "blocked" },
    });
    const toolResult = asToolResult(result.content);

    expect(toolResult.isError).toBeTrue();
    expect(toolResult.content.at(0)?.text).toContain(
      "Path traversal detected",
    );
  });

  test("symlink escape returns tool error", async () => {
    const context = makeContext(["tool:read"], sandboxRoot);
    const linkPath = join(sandboxRoot, "escape-link.txt");

    await symlink(join(siblingRoot, "secret.txt"), linkPath);

    const result = await registry.execute(context, {
      name: "read",
      input: { path: "escape-link.txt" },
    });
    const toolResult = asToolResult(result.content);

    expect(toolResult.isError).toBeTrue();
    expect(toolResult.content.at(0)?.text).toContain(
      "Path traversal detected",
    );
  });

  test("read and edit remain allowed inside sandbox root", async () => {
    const context = makeContext(["tool:read", "tool:edit"], sandboxRoot);

    const readResult = await registry.execute(context, {
      name: "read",
      input: { path: "allowed.txt" },
    });
    expect(asToolResult(readResult.content).content.at(0)?.text).toBe(
      "allowed content",
    );

    const editResult = await registry.execute(context, {
      name: "edit",
      input: { path: "allowed.txt", find: "allowed", replace: "edited" },
    });
    expect(asToolResult(editResult.content).isError ?? false).toBeFalse();
    expect(await Bun.file(join(sandboxRoot, "allowed.txt")).text()).toBe(
      "edited content",
    );
  });

  test("grep, find, and ls are constrained to sandbox root", async () => {
    const grepContext = makeContext(["tool:grep"], sandboxRoot);
    const grepResult = await registry.execute(grepContext, {
      name: "grep",
      input: { pattern: "needle", path: "." },
    });
    expect(asToolResult(grepResult.content).isError ?? false).toBeFalse();
    expect(asToolResult(grepResult.content).content.at(0)?.text).toContain(
      "needle",
    );

    const findContext = makeContext(["tool:find"], sandboxRoot);
    const findResult = await registry.execute(findContext, {
      name: "find",
      input: { pattern: "*.txt", path: "." },
    });
    expect(asToolResult(findResult.content).isError ?? false).toBeFalse();
    expect(asToolResult(findResult.content).content.at(0)?.text).toContain(
      "allowed.txt",
    );

    const lsContext = makeContext(["tool:ls"], sandboxRoot);
    const lsResult = await registry.execute(lsContext, {
      name: "ls",
      input: { path: "." },
    });
    expect(asToolResult(lsResult.content).isError ?? false).toBeFalse();
    expect(asToolResult(lsResult.content).content.at(0)?.text).toContain(
      "allowed.txt",
    );

    const blockedResult = await registry.execute(grepContext, {
      name: "grep",
      input: { pattern: "needle", path: dirname(sandboxRoot) },
    });
    const blockedToolResult = asToolResult(blockedResult.content);
    expect(blockedToolResult.isError).toBeTrue();
    expect(blockedToolResult.content.at(0)?.text).toContain(
      "Path traversal detected",
    );
  });

  test("bash reports the sandbox cwd for pwd", async () => {
    const context = makeContext(["tool:bash"], sandboxRoot);
    const result = await registry.execute(context, {
      name: "bash",
      input: { command: "pwd" },
    });
    const toolResult = asToolResult(result.content);

    expect(toolResult.isError ?? false).toBeFalse();
    expect(toolResult.content.at(0)?.text).toBe(resolve(sandboxRoot));
    expect(result.debug?.cwd).toBe(resolve(sandboxRoot));
  });
});
