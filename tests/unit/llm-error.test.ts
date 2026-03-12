import { LlmError } from "@pi-bun-effect/llm";
import { describe, expect, test } from "bun:test";

describe("LlmError", () => {
  test("uses the default code", () => {
    const error = new LlmError("An error occurred");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toBe("An error occurred");
    expect(error.code).toBe("LLM_ERROR");
  });

  test("accepts a custom code", () => {
    const error = new LlmError("Another error occurred", "CUSTOM_ERROR");

    expect(error.message).toBe("Another error occurred");
    expect(error.code).toBe("CUSTOM_ERROR");
  });
});
