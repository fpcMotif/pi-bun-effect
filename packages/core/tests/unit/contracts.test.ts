import { describe, expect, it } from "bun:test";
import { isAgentMessage } from "../../src/contracts";

describe("isAgentMessage", () => {
  it("should return true for valid AgentMessage objects", () => {
    expect(
      isAgentMessage({
        id: "1",
        role: "assistant",
        type: "text",
        content: "hello",
      }),
    ).toBe(true);
    expect(
      isAgentMessage({
        id: "2",
        role: "user",
        type: "image",
        url: "http://example.com",
      }),
    ).toBe(true);
    expect(isAgentMessage({ id: "3", role: "system", type: "text" })).toBe(
      true,
    );
  });

  it("should return false for objects missing required properties", () => {
    expect(isAgentMessage({ role: "assistant", type: "text" })).toBe(false); // missing id
    expect(isAgentMessage({ id: "1", type: "text" })).toBe(false); // missing role
    expect(isAgentMessage({ id: "1", role: "assistant" })).toBe(false); // missing type
    expect(isAgentMessage({})).toBe(false); // empty object
  });

  it("should return false for objects with incorrect types for required properties", () => {
    expect(isAgentMessage({ id: 1, role: "assistant", type: "text" })).toBe(
      false,
    ); // id is number
    expect(isAgentMessage({ id: "1", role: 123, type: "text" })).toBe(false); // role is number
    expect(isAgentMessage({ id: "1", role: "assistant", type: true })).toBe(
      false,
    ); // type is boolean
  });

  it("should return false for non-object inputs", () => {
    expect(isAgentMessage(null)).toBe(false);
    expect(isAgentMessage(undefined)).toBe(false);
    expect(isAgentMessage("hello")).toBe(false);
    expect(isAgentMessage(123)).toBe(false);
    expect(isAgentMessage(true)).toBe(false);
    expect(isAgentMessage([])).toBe(false); // Technically an array, but lacks the specific properties so handles gracefully
  });
});
