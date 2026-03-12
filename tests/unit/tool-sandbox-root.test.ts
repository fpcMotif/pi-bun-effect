import type { Capability } from "@pi-bun-effect/extensions";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createToolRegistry,
  registerBuiltinTools,
} from "../../packages/tools/src/registry.js";

test("tool sandbox root enforcement prevents symlink escapes on non-existent files", async () => {
  const base = mkdtempSync(join(tmpdir(), "pi-bun-effect-sandbox-"));
  const sandbox = join(base, "sandbox");
  const outside = join(base, "outside");
  mkdirSync(sandbox);
  mkdirSync(outside);

  // Create a symlink inside the sandbox pointing outside
  symlinkSync(outside, join(sandbox, "link-to-outside"));

  const registry = createToolRegistry();
  registerBuiltinTools(registry);
  const context = {
    sessionId: "test",
    extensionId: "test",
    capabilities: new Set(["tool:write"] as Capability[]),
    trust: "trusted" as const,
    sandboxRoot: sandbox,
  };

  // Attempt to write to a non-existent file inside the symlinked directory
  const result = await registry.execute(context, {
    name: "write",
    input: {
      path: join(sandbox, "link-to-outside", "new-file.txt"),
      text: "hacked",
    },
  });

  expect((result.content as any).isError).toBe(true);
  expect((result.content as any).content[0].text).toContain(
    "escapes sandbox via symlink",
  );
});
