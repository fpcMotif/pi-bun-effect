import type { AgentMessage, ContentBlock } from "@pi-bun-effect/core";

export interface CompactionResult {
  cutIndex: number;
  removed: AgentMessage[];
  retained: AgentMessage[];
  summaryText: string;
}

export interface CompactionOptions {
  maxTokens: number;
}

export function estimateTokens(message: AgentMessage): number {
  let total = 6;
  for (const block of message.content) {
    total += blockTokenCost(block);
  }
  return total;
}

function blockTokenCost(block: ContentBlock): number {
  switch (block.type) {
    case "text":
      return Math.max(1, Math.ceil((block.text?.length ?? 0) / 4));
    case "toolCall":
      return Math.max(1, Math.ceil((block.data?.length ?? 0) / 4));
    case "thinking":
      return Math.max(1, Math.ceil((block.text?.length ?? 0) / 6));
    case "image":
      return 16;
    default:
      return 1;
  }
}

function toolCallIdsFromAssistant(message: AgentMessage): Set<string> {
  const ids = new Set<string>();
  if (message.type !== "assistant") {
    return ids;
  }

  for (const block of message.content) {
    if (block.type !== "toolCall") {
      continue;
    }

    const withId = block as ContentBlock & { id?: string; toolCallId?: string };
    if (typeof withId.toolCallId === "string") {
      ids.add(withId.toolCallId);
    }
    if (typeof withId.id === "string") {
      ids.add(withId.id);
    }

    if (typeof block.data === "string") {
      try {
        const parsed = JSON.parse(block.data) as { id?: string; toolCallId?: string };
        if (typeof parsed.toolCallId === "string") {
          ids.add(parsed.toolCallId);
        }
        if (typeof parsed.id === "string") {
          ids.add(parsed.id);
        }
      } catch {
        // best-effort parser
      }
    }
  }

  return ids;
}

function calculateCutIndex(messages: AgentMessage[], maxTokens: number): number {
  const totalTokens = messages.reduce((sum, message) => sum + estimateTokens(message), 0);
  if (totalTokens <= maxTokens) {
    return 0;
  }

  let retainedTokens = 0;
  let cutIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const next = retainedTokens + estimateTokens(messages[i]!);
    if (next > maxTokens) {
      break;
    }
    retainedTokens = next;
    cutIndex = i;
  }

  // Never split assistant tool-call messages from their matching tool results.
  while (cutIndex < messages.length) {
    const removed = messages.slice(0, cutIndex);
    const removedToolCallIds = new Set<string>();
    for (const message of removed) {
      for (const id of toolCallIdsFromAssistant(message)) {
        removedToolCallIds.add(id);
      }
    }

    let crossingIndex = -1;
    for (let i = cutIndex; i < messages.length; i++) {
      const message = messages[i]!;
      if (message.type === "toolResult" && removedToolCallIds.has(message.toolCallId)) {
        crossingIndex = i;
      }
    }

    if (crossingIndex === -1) {
      break;
    }

    cutIndex = crossingIndex + 1;
  }

  return Math.min(cutIndex, messages.length);
}

function buildSummary(removed: AgentMessage[]): string {
  if (removed.length === 0) {
    return "No compaction needed.";
  }

  const first = removed[0]!;
  const last = removed[removed.length - 1]!;
  return `Compacted ${removed.length} messages (${first.type} -> ${last.type}).`;
}

export function compactTranscript(
  messages: AgentMessage[],
  options: CompactionOptions,
): CompactionResult {
  const cutIndex = calculateCutIndex(messages, options.maxTokens);
  const removed = messages.slice(0, cutIndex);
  const retained = messages.slice(cutIndex);

  return {
    cutIndex,
    removed,
    retained,
    summaryText: buildSummary(removed),
  };
}
