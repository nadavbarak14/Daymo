import { describe, it, expect } from "vitest";
import { assertEmbeddingModel } from "../../../src/chat-core/embedding-guard.js";

describe("assertEmbeddingModel", () => {
  it("passes when ids match", () => {
    expect(() => assertEmbeddingModel("gemini-embedding-001", "gemini-embedding-001")).not.toThrow();
  });

  it("throws a clear error when the query model differs from the index model", () => {
    expect(() => assertEmbeddingModel("gemini-embedding-001", "text-embedding-3")).toThrow(
      /index was built with "gemini-embedding-001" but the route is configured with "text-embedding-3"/,
    );
  });
});
