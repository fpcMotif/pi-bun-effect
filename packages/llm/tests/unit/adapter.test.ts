import { describe, expect, it } from "bun:test";
import { LlmError } from "../../src/adapter";

describe("LlmError", () => {
  it("should create an instance with the provided message and default code", () => {
    const message = "An error occurred";
    const error = new LlmError(message);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toBe(message);
    expect(error.code).toBe("LLM_ERROR");
    expect(error.name).toBe("Error"); // Since we don't override name in LlmError
  });

  it("should create an instance with a custom code if provided", () => {
    const message = "Another error occurred";
    const customCode = "CUSTOM_ERROR_CODE";
    const error = new LlmError(message, customCode);

    expect(error.message).toBe(message);
    expect(error.code).toBe(customCode);
  });
});
