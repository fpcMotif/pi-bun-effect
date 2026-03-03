import type { RpcRequest } from "@pi-bun-effect/rpc";
import { createRpcProtocol } from "@pi-bun-effect/rpc";
import { expect, test } from "bun:test";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createFrame(seed: number, command = "prompt", text: string): string {
  return JSON.stringify({
    id: `seed-${seed}`,
    command,
    payload: {
      sessionId: "fuzz",
      message: {
        type: "user",
        role: "user",
        id: `u-${seed}`,
        timestamp: new Date().toISOString(),
        content: [
          {
            type: "text",
            text,
          },
        ],
      },
    },
  });
}

function splitIntoChunks(text: string, seed: number): string[] {
  const encoded = new TextEncoder().encode(text);
  const values = seededRandom(seed);
  const chunks: string[] = [];
  let offset = 0;

  while (offset < encoded.length) {
    const max = Math.min(12, encoded.length - offset);
    const chunkSize = Math.max(1, Math.floor(values() * max) + 1);
    const chunk = encoded.slice(offset, offset + chunkSize);
    offset += chunk.length;
    chunks.push(new TextDecoder().decode(chunk));
  }

  return chunks;
}

function recoverLine(chunks: string[]): string {
  const decoder = new TextDecoder();
  let out = "";
  for (const chunk of chunks) {
    out += decoder.decode(new TextEncoder().encode(chunk), { stream: true });
  }
  out += decoder.decode();
  return out;
}

test("fuzz: randomized chunked rpc-json stream recovers valid frames", () => {
  const protocol = createRpcProtocol();

  for (let seed = 1; seed <= 50; seed += 1) {
    const frame = createFrame(seed, "prompt", "😀 fuzz boundary");
    const chunks = splitIntoChunks(frame, seed);
    const text = recoverLine(chunks);
    const parsed = protocol.parseLine(text) as RpcRequest | null;

    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(`seed-${seed}`);
    expect(parsed?.command).toBe("prompt");
  }
});

test("fuzz: malformed partial JSON recovers once a valid frame appears", () => {
  const protocol = createRpcProtocol();
  const validFrame = `${createFrame(9001, "get_state", "baseline")}\n`;
  const malformed = `{"id":"bad","command":"prompt","payload":${"{"}\n`;
  const stream = `${malformed}${validFrame}`;

  const lines = stream.split("\n").filter(Boolean);
  expect(protocol.parseLine(lines[0] ?? "")).toBeNull();
  const parsed = protocol.parseLine(lines[1] ?? "");
  expect(parsed).not.toBeNull();
  expect(parsed?.id).toBe("seed-9001");
  expect(parsed?.command).toBe("get_state");
});

test("fuzz: utf-8 boundaries preserve non-ascii payload integrity", () => {
  const protocol = createRpcProtocol();
  const boundaryFrame = createFrame(17, "prompt", "unicode: 😀 🚀 你 好");
  const bytes = new TextEncoder().encode(boundaryFrame);
  const parts = [bytes.subarray(0, 7), bytes.subarray(7, 9), bytes.subarray(9)];

  const decoder = new TextDecoder("utf-8");
  let reconstructed = "";
  reconstructed += decoder.decode(parts[0], { stream: true });
  reconstructed += decoder.decode(parts[1], { stream: true });
  reconstructed += decoder.decode(parts[2]);

  const parsed = protocol.parseLine(reconstructed);
  expect(parsed?.id).toBe("seed-17");
});
