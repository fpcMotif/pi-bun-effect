import { JsonlSessionStore } from "./packages/session/src/session-store.ts";
import { rm, writeFile } from "node:fs/promises";
import { AgentMessage } from "./packages/core/src/contracts.ts";

async function runBenchmark() {
  const store = new JsonlSessionStore();
  const path = "/tmp/test-session.jsonl";

  // Create a large session file
  const header = { version: 3, id: "test-session", createdAt: new Date().toISOString() };
  let content = JSON.stringify(header) + "\n";

  const numEntries = 50000;
  let lastId = "root";

  content += JSON.stringify({
    id: lastId,
    type: "test",
    timestamp: new Date().toISOString(),
    data: { role: "user", type: "user", id: "msg-root", timestamp: new Date().toISOString(), content: [{ type: "text", text: "hello" }] } as AgentMessage
  }) + "\n";

  for (let i = 0; i < numEntries; i++) {
    const id = `entry-${i}`;
    content += JSON.stringify({
      id,
      type: "test",
      parentId: lastId,
      timestamp: new Date().toISOString(),
      data: { role: "user", type: "user", id: `msg-${i}`, timestamp: new Date().toISOString(), content: [{ type: "text", text: `message ${i}` }] } as AgentMessage
    }) + "\n";
    lastId = id;
  }

  await writeFile(path, content);

  // Warmup
  await store.linearizeFrom(path, lastId);

  // Benchmark
  const start = performance.now();
  const iterations = 50;
  for (let i = 0; i < iterations; i++) {
    await store.linearizeFrom(path, lastId);
  }
  const end = performance.now();

  console.log(`Average time over ${iterations} iterations: ${(end - start) / iterations}ms`);

  await rm(path);
}

runBenchmark().catch(console.error);
