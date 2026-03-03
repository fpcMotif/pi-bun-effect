import { expect, test } from "bun:test";

interface TurnNode {
  role: "assistant" | "tool";
  type: "assistant" | "toolResult";
}

function compactionCutPoint(nodes: TurnNode[], budget: number): number {
  if (nodes.length <= budget) {
    return nodes.length;
  }

  const cut = budget;
  const prior = nodes[cut - 1];
  const next = nodes[cut];

  if (
    prior?.role === "assistant"
    && prior.type === "assistant"
    && next?.type === "toolResult"
  ) {
    return cut;
  }

  if (
    prior?.type === "toolResult"
    && prior.role === "tool"
    && prior.type === "toolResult"
  ) {
    return cut;
  }

  return cut;
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
