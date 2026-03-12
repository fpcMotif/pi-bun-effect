import { isAgentMessage } from "@pi-bun-effect/core";
import { describe, expect, test } from "bun:test";

describe("isAgentMessage", () => {
  test("returns true for valid agent messages", () => {
    expect(
      isAgentMessage({
        id: "msg-123",
        role: "assistant",
        type: "assistant",
      }),
    ).toBe(true);

    expect(
      isAgentMessage({
        id: "msg-456",
        role: "user",
        type: "user",
        content: [], // Extra properties are ignored
      }),
    ).toBe(true);
  });

  test("returns false for non-objects or null", () => {
    expect(isAgentMessage(null)).toBe(false);
    expect(isAgentMessage(undefined)).toBe(false);
    expect(isAgentMessage("string")).toBe(false);
    expect(isAgentMessage(123)).toBe(false);
    expect(isAgentMessage(true)).toBe(false);
    expect(isAgentMessage([])).toBe(false);
  });

  test("returns false for missing required properties", () => {
    expect(
      isAgentMessage({
        role: "user",
        type: "user",
      }),
    ).toBe(false); // missing id

    expect(
      isAgentMessage({
        id: "msg-1",
        type: "user",
      }),
    ).toBe(false); // missing role

    expect(
      isAgentMessage({
        id: "msg-1",
        role: "user",
      }),
    ).toBe(false); // missing type
  });

  test("returns false for incorrect property types", () => {
    expect(
      isAgentMessage({
        id: 123, // id should be string
        role: "user",
        type: "user",
      }),
    ).toBe(false);

    expect(
      isAgentMessage({
        id: "msg-1",
        role: 123, // role should be string
        type: "user",
      }),
    ).toBe(false);

    expect(
      isAgentMessage({
        id: "msg-1",
        role: "user",
        type: 123, // type should be string
      }),
    ).toBe(false);
  });
});
