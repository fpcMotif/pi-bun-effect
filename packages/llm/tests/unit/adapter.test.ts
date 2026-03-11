import { describe, expect, it } from "bun:test";
import { LlmError } from "../../src/adapter";

describe("LlmError", () => {
  it("should create an instance with the correct message and default code", () => {
    const message = "An error occurred";
    const error = new LlmError(message);

    expect(error.message).toBe(message);
    expect(error.code).toBe("LLM_ERROR");
  });

  it("should create an instance with a custom code if provided", () => {
    const message = "A specific error occurred";
    const code = "SPECIFIC_ERROR";
    const error = new LlmError(message, code);

    expect(error.message).toBe(message);
    expect(error.code).toBe(code);
  });

  it("should be an instance of Error", () => {
    const error = new LlmError("An error occurred");

    expect(error).toBeInstanceOf(Error);
  });
});
