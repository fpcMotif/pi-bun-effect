import { describe, expect, test } from "bun:test";
import { loadFromPath } from "../../packages/extensions/src/loaders";

describe("loaders", () => {
  test("loadFromPath handles async missing path gracefully", async () => {
    // We expect it to throw since we're pointing to an invalid directory
    await expect(loadFromPath("/dev/null/fake-ext")).rejects.toThrow();
  });
});
