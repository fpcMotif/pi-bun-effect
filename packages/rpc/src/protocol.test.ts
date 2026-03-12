import { expect, test } from "bun:test";
import { createRpcProtocol } from "./protocol";
import { InMemoryLogger } from "@pi-bun-effect/core";

test("JsonRpcProtocol logs parse errors when logger is provided", () => {
  const logger = new InMemoryLogger();
  const protocol = createRpcProtocol(logger);

  const result = protocol.parseLine("{ invalid json }");

  expect(result).toBeNull();
  expect(logger.entries.length).toBe(1);
  expect(logger.entries[0].level).toBe("debug");
  expect(logger.entries[0].message).toBe("Failed to parse RPC line as JSON");
  expect(logger.entries[0].data?.error).toBeDefined();
});

test("JsonRpcProtocol does not throw and returns null when logger is not provided", () => {
  const protocol = createRpcProtocol();

  const result = protocol.parseLine("{ invalid json }");

  expect(result).toBeNull();
});

test("JsonRpcProtocol truncates long lines in log", () => {
  const logger = new InMemoryLogger();
  const protocol = createRpcProtocol(logger);

  const longLine = "{" + "a".repeat(200);
  protocol.parseLine(longLine);

  expect(logger.entries[0].data?.line).toBe(longLine.substring(0, 100) + "...");
});
