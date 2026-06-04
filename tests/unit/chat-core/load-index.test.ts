import { describe, it, expect } from "vitest";
import { loadIndex } from "../../../src/chat-core/load-index.js";
import type { IndexFile } from "../../../src/types.js";

const index: IndexFile = {
  version: "v1",
  widgetId: "help",
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 2,
  videoBaseUrl: "https://cdn/help/v1",
  createdAt: "2026-06-04T00:00:00Z",
  etag: "sha256:x",
  demos: [],
  chunks: [
    {
      stepId: "d:0:1",
      demoId: "d",
      sceneIndex: 0,
      stepIndex: 1,
      globalStartMs: 0,
      globalEndMs: 10,
      text: "t",
      embedding: [0, 1],
      keywords: ["t"],
    },
  ],
};

describe("loadIndex", () => {
  it("builds a stepLookup keyed by stepId and carries videoBaseUrl", () => {
    const loaded = loadIndex(index, { suggestedQuestions: ["How do I X?"], defaultLocale: "en" });
    expect(loaded.stepLookup.get("d:0:1")?.demoId).toBe("d");
    expect(loaded.videoBaseUrl).toBe("https://cdn/help/v1");
    expect(loaded.defaultLocale).toBe("en");
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      loadIndex({ ...index, version: "v2" as IndexFile["version"] }, {
        suggestedQuestions: [],
        defaultLocale: "en",
      }),
    ).toThrow(/unsupported index version/);
  });
});
