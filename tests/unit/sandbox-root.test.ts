import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { createToolRegistry, registerBuiltinTools } from "../../packages/tools/src/registry";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("sandboxRoot enforcement", () => {
  let sandboxRoot: string;
  const registry = createToolRegistry();
  registerBuiltinTools(registry);

  beforeAll(async () => {
    sandboxRoot = await mkdtemp(join(tmpdir(), "sandbox-root-test-"));
  });

  afterAll(async () => {
    await rm(sandboxRoot, { recursive: true, force: true });
  });

  test("should allow writing within sandboxRoot", async () => {
    const context = {
      sessionId: "test-session",
      extensionId: "test-ext",
      capabilities: new Set(["tool:write"]),
      trust: "trusted" as const,
      sandboxRoot,
    };

    const path = "test.txt";
    const text = "hello sandbox";

    await registry.execute(context, {
      name: "write",
      input: { path, text },
    });

    const fullPath = join(sandboxRoot, path);
    const content = await Bun.file(fullPath).text();
    expect(content).toBe(text);
  });

  test("should block writing outside of sandboxRoot", async () => {
    const context = {
      sessionId: "test-session",
      extensionId: "test-ext",
      capabilities: new Set(["tool:write"]),
      trust: "trusted" as const,
      sandboxRoot,
    };

    const path = "../outside.txt";
    const text = "not allowed";

    try {
      await registry.execute(context, {
        name: "write",
        input: { path, text },
      });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.message).toContain("Security Error: Path is outside of sandbox");
    }
  });

  test("BASH_TOOL should use sandboxRoot as cwd", async () => {
    const context = {
        sessionId: "test-session",
        extensionId: "test-ext",
        capabilities: new Set(["tool:bash"]),
        trust: "trusted" as const,
        sandboxRoot,
      };

      const result = await registry.execute(context, {
        name: "bash",
        input: { command: "pwd" },
      });

      const pwdOutput = result.content.content.at(0)?.text?.trim();
      expect(pwdOutput).toBe(resolve(sandboxRoot));
  });

  test("READ_TOOL should respect sandboxRoot", async () => {
    const context = {
        sessionId: "test-session",
        extensionId: "test-ext",
        capabilities: new Set(["tool:read"]),
        trust: "trusted" as const,
        sandboxRoot,
    };

    // Pre-create a file in sandbox root
    await Bun.write(join(sandboxRoot, "read-test.txt"), "read content");

    const result = await registry.execute(context, {
        name: "read",
        input: { path: "read-test.txt" },
    });

    expect(result.content.content.at(0)?.text).toBe("read content");

    // Try to read outside
    try {
        await registry.execute(context, {
            name: "read",
            input: { path: "../something.txt" },
        });
        expect(true).toBe(false);
    } catch (error: any) {
        expect(error.message).toContain("Security Error: Path is outside of sandbox");
    }
  });

  test("EDIT_TOOL should respect sandboxRoot", async () => {
    const context = {
        sessionId: "test-session",
        extensionId: "test-ext",
        capabilities: new Set(["tool:edit"]),
        trust: "trusted" as const,
        sandboxRoot,
    };

    // Pre-create a file
    const filePath = join(sandboxRoot, "edit-test.txt");
    await Bun.write(filePath, "original content");

    await registry.execute(context, {
        name: "edit",
        input: { path: "edit-test.txt", find: "original", replace: "edited" },
    });

    const next = await Bun.file(filePath).text();
    expect(next).toBe("edited content");

    // Try to edit outside
    try {
        await registry.execute(context, {
            name: "edit",
            input: { path: "../something.txt", find: "a", replace: "b" },
        });
        expect(true).toBe(false);
    } catch (error: any) {
        expect(error.message).toContain("Security Error: Path is outside of sandbox");
    }
  });
});
