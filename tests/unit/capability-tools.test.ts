import type { Capability, TrustDecision } from "@pi-bun-effect/extensions";
import {
  createToolRegistry,
  registerBuiltinTools,
  type ToolContext,
} from "@pi-bun-effect/tools";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeContext(
  capabilities: Capability[],
  trust: TrustDecision = "trusted",
  sandboxRoot?: string,
): ToolContext {
  return {
    sessionId: "cap-test",
    extensionId: "ext-cap",
    capabilities: new Set(capabilities),
    trust,
    sandboxRoot,
  };
}

test("capability enforcement denies tool execution without matching capability", async () => {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);

  const restricted = makeContext(["tool:read"]);
  await expect(
    registry.execute(restricted, {
      name: "bash",
      input: { command: "echo hi" },
    }),
  ).rejects.toThrow("capability denied: tool:bash");

  const granted = makeContext(["tool:bash"]);
  const result = await registry.execute(granted, {
    name: "bash",
    input: { command: "printf 'cap-ok'" },
  });
  expect(result.content.content.at(0)?.text).toContain("cap-ok");
});

test("trust enforcement blocks bash until the extension is trusted", async () => {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);

  await expect(
    registry.execute(makeContext(["tool:bash"], "pending"), {
      name: "bash",
      input: { command: "echo denied" },
    }),
  ).rejects.toThrow("trust denied: pending cannot use tool:bash");
});

test("capability enforcement allows all tools with full capability set", async () => {
  const registry = createToolRegistry();
  registerBuiltinTools(registry);

  const full = makeContext([
    "tool:read",
    "tool:write",
    "tool:edit",
    "tool:bash",
    "tool:grep",
    "tool:find",
    "tool:ls",
  ]);

  const tools = registry.list();
  expect(tools.length).toBe(7);

  for (const tool of tools) {
    if (tool.name === "read" || tool.name === "write" || tool.name === "edit") {
      continue;
    }
    const result = await registry.execute(full, {
      name: tool.name,
      input: tool.name === "bash"
        ? { command: "echo ok" }
        : { path: ".", pattern: "test" },
    });
    expect(result.content.type).toBe("toolResult");
  }
});

test("grep tool searches file contents", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-grep-"));
  writeFileSync(
    join(root, "haystack.txt"),
    "needle in a haystack\nno match here",
  );

  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const ctx = makeContext(["tool:grep"], "trusted", root);

  const result = await registry.execute(ctx, {
    name: "grep",
    input: { pattern: "needle", path: "." },
  });
  expect(result.content.content.at(0)?.text).toContain("needle");
  rmSync(root, { recursive: true, force: true });
});

test("find tool finds files by pattern", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-find-"));
  writeFileSync(join(root, "target.md"), "found");
  writeFileSync(join(root, "ignore.txt"), "skip");

  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const ctx = makeContext(["tool:find"], "trusted", root);

  const result = await registry.execute(ctx, {
    name: "find",
    input: { pattern: "*.md", path: "." },
  });
  expect(result.content.content.at(0)?.text).toContain("target.md");
  rmSync(root, { recursive: true, force: true });
});

test("ls tool lists directory contents", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-ls-"));
  writeFileSync(join(root, "file-a.txt"), "a");
  writeFileSync(join(root, "file-b.txt"), "b");

  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const ctx = makeContext(["tool:ls"], "trusted", root);

  const result = await registry.execute(ctx, {
    name: "ls",
    input: { path: "." },
  });
  const text = result.content.content.at(0)?.text ?? "";
  expect(text).toContain("file-a.txt");
  expect(text).toContain("file-b.txt");
  rmSync(root, { recursive: true, force: true });
});

test("edit tool rejects empty find values", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-bun-effect-edit-"));
  writeFileSync(join(root, "payload.txt"), "seed");

  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const ctx = makeContext(["tool:edit"], "trusted", root);

  const result = await registry.execute(ctx, {
    name: "edit",
    input: { path: "payload.txt", find: "", replace: "noop" },
  });

  expect(result.content.type).toBe("toolResult");
  if (result.content.type !== "toolResult") {
    throw new Error("expected toolResult");
  }
  expect(result.content.isError).toBeTrue();
  expect(result.content.content.at(0)?.text).toContain(
    "non-empty find value",
  );
  rmSync(root, { recursive: true, force: true });
});
