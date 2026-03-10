import type { AgentMessage } from "@pi-bun-effect/core";
import { compactTranscript } from "@pi-bun-effect/agent";
import { expect, test } from "bun:test";

function assistant(id: string, text: string, toolCallId?: string): AgentMessage {
  return {
    type: "assistant",
    role: "assistant",
    id,
    timestamp: "2024-01-01T00:00:00.000Z",
    content: toolCallId
      ? [{ type: "toolCall", data: JSON.stringify({ toolCallId, name: "read" }) }]
      : [{ type: "text", text }],
  };
}

function toolResult(id: string, toolCallId: string, text: string): AgentMessage {
  return {
    type: "toolResult",
    role: "tool",
    id,
    timestamp: "2024-01-01T00:00:00.000Z",
    toolCallId,
    content: [{ type: "text", text }],
  };
}

test("split-turn compaction inserts deterministic summary and trims prefix", () => {
  const messages: AgentMessage[] = [
    assistant("a1", "alpha ".repeat(18)),
    assistant("a2", "beta ".repeat(18)),
    assistant("a3", "gamma ".repeat(6)),
  ];

  const result = compactTranscript(messages, { maxTokens: 45 });

  expect(result.cutIndex).toBe(2);
  expect(result.removed.map((message) => message.id)).toEqual(["a1", "a2"]);
  expect(result.retained.map((message) => message.id)).toEqual(["a3"]);
  expect(result.summaryText).toBe("Compacted 2 messages (assistant -> assistant).");
});

test("tool call boundary never separates tool call from tool result", () => {
  const messages: AgentMessage[] = [
    assistant("a1", "intro"),
    assistant("a2", "tool request", "call-1"),
    toolResult("t1", "call-1", "tool output"),
    assistant("a3", "tail ".repeat(14)),
  ];

  const result = compactTranscript(messages, { maxTokens: 28 });

  expect(result.cutIndex).toBe(3);
  expect(result.removed.map((message) => message.id)).toEqual(["a1", "a2", "t1"]);
  expect(result.retained.map((message) => message.id)).toEqual(["a3"]);
});

test("repeated compaction is stable and does not over-trim", () => {
  const messages: AgentMessage[] = [
    assistant("a1", "one ".repeat(16)),
    assistant("a2", "two ".repeat(16)),
    assistant("a3", "three ".repeat(6)),
  ];

  const first = compactTranscript(messages, { maxTokens: 45 });
  const second = compactTranscript(first.retained, { maxTokens: 45 });

  expect(first.cutIndex).toBe(2);
  expect(second.cutIndex).toBe(0);
  expect(second.removed).toHaveLength(0);
  expect(second.retained.map((message) => message.id)).toEqual(["a3"]);
});
