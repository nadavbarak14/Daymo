import { describe, it, expect } from "vitest";
import type { IndexFile } from "../../src/types.js";

describe("IndexFile shape", () => {
  it("accepts a configurable embeddingModel string and a videoBaseUrl", () => {
    const idx: IndexFile = {
      version: "v1",
      widgetId: "help",
      embeddingModel: "some-other-model", // must compile (was a literal before)
      embeddingDims: 768,
      videoBaseUrl: "https://cdn.example.com/help/v1",
      createdAt: "2026-06-04T00:00:00Z",
      etag: "sha256:abc",
      demos: [],
      chunks: [],
    };
    expect(idx.videoBaseUrl).toContain("https://");
    expect(idx.embeddingModel).toBe("some-other-model");
  });
});
