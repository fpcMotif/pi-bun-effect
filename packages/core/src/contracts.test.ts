import { describe, expect, it } from "bun:test";
import { isAgentMessage } from "./contracts";

describe("isAgentMessage", () => {
  it("returns false for null or undefined", () => {
    expect(isAgentMessage(null)).toBe(false);
    expect(isAgentMessage(undefined)).toBe(false);
  });

  it("returns false for non-object primitives", () => {
    expect(isAgentMessage("string")).toBe(false);
    expect(isAgentMessage(123)).toBe(false);
    expect(isAgentMessage(true)).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isAgentMessage({})).toBe(false);
  });

  it("returns false for objects missing required fields", () => {
    expect(isAgentMessage({ id: "1" })).toBe(false);
    expect(isAgentMessage({ id: "1", role: "user" })).toBe(false);
    expect(isAgentMessage({ id: "1", type: "user" })).toBe(false);
    expect(isAgentMessage({ role: "user", type: "user" })).toBe(false);
  });

  it("returns false if required fields have incorrect types", () => {
    expect(isAgentMessage({ id: 123, role: "user", type: "user" })).toBe(false);
  });

  it("returns true for valid objects", () => {
    expect(
      isAgentMessage({
        id: "msg_1",
        role: "user",
        type: "user",
      }),
    ).toBe(true);

    expect(
      isAgentMessage({
        id: "msg_2",
        role: "assistant",
        type: "assistant",
        content: [],
      }),
    ).toBe(true);

    expect(
      isAgentMessage({
        id: "msg_3",
        role: "tool",
        type: "toolResult",
        toolCallId: "call_1",
      }),
    ).toBe(true);
  });
});
