import { isAgentMessage } from "@pi-bun-effect/core";
import { describe, expect, it } from "bun:test";

describe("isAgentMessage", () => {
  it("should return true for valid AgentMessage", () => {
    expect(
      isAgentMessage({
        id: "msg-123",
        role: "user",
        type: "text",
        content: "Hello",
      }),
    ).toBe(true);
  });

  it("should return false for null", () => {
    expect(isAgentMessage(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isAgentMessage(undefined)).toBe(false);
  });

  it("should return false for primitives", () => {
    expect(isAgentMessage(123)).toBe(false);
    expect(isAgentMessage("string")).toBe(false);
    expect(isAgentMessage(true)).toBe(false);
  });

  it("should return false if id is missing", () => {
    expect(
      isAgentMessage({
        role: "user",
        type: "text",
      }),
    ).toBe(false);
  });

  it("should return false if role is missing", () => {
    expect(
      isAgentMessage({
        id: "msg-123",
        type: "text",
      }),
    ).toBe(false);
  });

  it("should return false if type is missing", () => {
    expect(
      isAgentMessage({
        id: "msg-123",
        role: "user",
      }),
    ).toBe(false);
  });

  it("should return false if id is not a string", () => {
    expect(
      isAgentMessage({
        id: 123,
        role: "user",
        type: "text",
      }),
    ).toBe(false);
  });

  it("should return false if role is not a string", () => {
    expect(
      isAgentMessage({
        id: "msg-123",
        role: 123,
        type: "text",
      }),
    ).toBe(false);
  });

  it("should return false if type is not a string", () => {
    expect(
      isAgentMessage({
        id: "msg-123",
        role: "user",
        type: 123,
      }),
    ).toBe(false);
  });
});
