import { describe, expect, test } from "bun:test";
import { LlmError } from "../../src/adapter";

describe("LlmError", () => {
  test("instantiates with message and default code", () => {
    const error = new LlmError("An error occurred");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("An error occurred");
    expect(error.code).toBe("LLM_ERROR");
  });

  test("instantiates with custom code", () => {
    const error = new LlmError("Another error", "CUSTOM_ERROR_CODE");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Another error");
    expect(error.code).toBe("CUSTOM_ERROR_CODE");
  });
});
