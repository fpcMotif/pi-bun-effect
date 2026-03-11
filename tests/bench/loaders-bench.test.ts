import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFromPath } from "../../packages/extensions/src/loaders";

const tempDir = join(process.cwd(), ".bench-tmp-loaders-async-new");
mkdirSync(tempDir, { recursive: true });
const manifestPath = join(tempDir, "extension.json");
writeFileSync(
  manifestPath,
  JSON.stringify({
    id: "test",
    name: "test",
    version: "1.0.0",
    capabilities: ["tool:read"],
    activationEvents: ["onStart"],
  }),
);

console.log("Benchmarking loadFromPath (async)");

async function runBench() {
  const start = performance.now();
  const promises = [];
  for (let i = 0; i < 10000; i++) {
    promises.push(loadFromPath(tempDir));
  }
  await Promise.all(promises);
  const end = performance.now();
  console.log(
    `10000 concurrent iterations of loadFromPath (async) took: ${
      end - start
    } ms`,
  );
}

await runBench();
rmSync(tempDir, { recursive: true, force: true });
