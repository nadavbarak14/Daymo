import { describe, it, expect } from "vitest";
import { buildManifest } from "../../../src/publish/manifest.js";
import type { IndexFile } from "../../../src/types.js";

const index: IndexFile = {
  version: "v1",
  widgetId: "help",
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 2,
  videoBaseUrl: "https://cdn/help/v1",
  createdAt: "x",
  etag: "x",
  demos: [{ demoId: "d", title: "Create a note", description: "How to create", durationMs: 9000 }],
  chunks: [
    { stepId: "d:0:2", demoId: "d", sceneIndex: 0, stepIndex: 2, globalStartMs: 5000, globalEndMs: 9000, text: "[Step]\nName it", embedding: [0.1, 0.2], keywords: ["name"] },
    { stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 1000, globalEndMs: 5000, text: "[Step]\nClick new", embedding: [0.3, 0.4], keywords: ["click"] },
  ],
};

describe("buildManifest", () => {
  it("derives video/poster URLs and sorts steps by startMs", () => {
    const m = buildManifest(index, { version: "v0.2.0" });
    expect(m.version).toBe("v0.2.0");
    expect(m.demos[0].videoUrl).toBe("https://cdn/help/v1/d/output.mp4");
    expect(m.demos[0].posterUrl).toBe("https://cdn/help/v1/d/poster.jpg");
    expect(m.demos[0].steps.map((s) => s.stepId)).toEqual(["d:0:1", "d:0:2"]);
    expect(m.demos[0].steps[0].label).toBe("Click new");
  });

  it("never includes embeddings in the manifest", () => {
    const m = buildManifest(index, { version: "v1" });
    expect(JSON.stringify(m)).not.toContain("embedding");
    expect(JSON.stringify(m)).not.toContain("0.3");
  });
});
