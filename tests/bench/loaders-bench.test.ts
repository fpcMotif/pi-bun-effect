import { loadFromPath } from "@pi-bun-effect/extensions";
import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("bench: async extension loader handles concurrent reads", async () => {
  const root = join(tmpdir(), `pi-bun-effect-loaders-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  writeFileSync(
    join(root, "extension.json"),
    JSON.stringify({
      id: "bench-extension",
      name: "Bench Extension",
      version: "1.0.0",
      capabilities: ["tool:read"],
      activationEvents: ["onStart"],
    }),
  );

  const start = performance.now();
  const results = await Promise.all(
    Array.from({ length: 500 }, () => loadFromPath(root)),
  );
  const duration = performance.now() - start;

  expect(results).toHaveLength(500);
  expect(results[0]?.manifest.id).toBe("bench-extension");
  expect(duration).toBeGreaterThanOrEqual(0);
  console.log(`[bench] extension-loadFromPath-500-ms=${duration.toFixed(2)}`);

  rmSync(root, { recursive: true, force: true });
});
