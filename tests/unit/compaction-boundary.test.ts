import { compactionCutPoint } from "@pi-bun-effect/agent";
import { expect, test } from "bun:test";

interface TurnNode {
  role: "assistant" | "tool";
  type: "assistant" | "toolResult";
}

test("compaction cut does not separate assistant tool-call and tool-result", () => {
  const nodes: TurnNode[] = [
    { role: "assistant", type: "assistant" },
    { role: "assistant", type: "assistant" },
    { role: "assistant", type: "assistant" },
    { role: "tool", type: "toolResult" },
    { role: "assistant", type: "assistant" },
  ];

  const cut = compactionCutPoint(nodes, 3);
  expect(cut).toBe(3);
});

test("compaction keeps tool pair when budget lands inside pair", () => {
  const nodes: TurnNode[] = [
    { role: "assistant", type: "assistant" },
    { role: "tool", type: "toolResult" },
    { role: "assistant", type: "assistant" },
    { role: "assistant", type: "assistant" },
    { role: "assistant", type: "assistant" },
  ];

  const cut = compactionCutPoint(nodes, 2);
  expect(cut).toBe(2);
});
