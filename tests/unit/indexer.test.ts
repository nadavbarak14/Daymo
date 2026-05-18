import { describe, it, expect } from "vitest";
import { buildIndex } from "../../src/core/indexer.js";
import type { Embedder } from "../../src/core/gemini-embed.js";

const mockEmbedder: Embedder = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t, i) => {
      const vec = new Array(768).fill(0);
      vec[i % 768] = 1;
      return vec;
    });
  },
};

describe("buildIndex", () => {
  it("produces an IndexJson with one chunk per non-empty step", async () => {
    const result = await buildIndex({
      companyId: "acme",
      demos: [{
        demoId: "tour",
        demoFile: "",
        ast: {
          frontmatter: { title: "Loomly Tour", description: "A tour", url: "", tts: { provider: "edge", voice: "x", rate: "+0%", music_duck: true } },
          scenes: [{
            sourceLine: 1,
            title: "Welcome",
            prose: "Greet the user.",
            overlays: [],
            steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }],
          }],
        },
        events: [[
          { kind: "scene_start", t: 0, index: 0, title: "Welcome", prose: "" },
          { kind: "say", t: 100, hash: "a", text: "Hello.", durationMs: 500, words: [] },
        ]],
        stepIndex: {
          demoId: "tour",
          mp4DurationMs: 2000,
          scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 2000, recordingOffsetMs: 0 }],
          steps: [{ stepId: "tour:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 2000 }],
        },
      }],
      embedder: mockEmbedder,
    });

    expect(result.schemaVersion).toBe(1);
    expect(result.companyId).toBe("acme");
    expect(result.embeddingModel).toBe("gemini-embedding-001");
    expect(result.embeddingDims).toBe(768);
    expect(result.demos).toEqual([{ demoId: "tour", title: "Loomly Tour", description: "A tour", durationMs: 2000 }]);
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].stepId).toBe("tour:0:0");
    expect(result.chunks[0].globalStartMs).toBe(0);
    expect(result.chunks[0].globalEndMs).toBe(2000);
    expect(result.chunks[0].embedding.length).toBe(768);
    expect(result.chunks[0].text).toContain("Hello.");
  });

  it("looks up (start,end)Ms from the step index by stepId", async () => {
    const result = await buildIndex({
      companyId: "acme",
      demos: [{
        demoId: "tour",
        demoFile: "",
        ast: { frontmatter: { title: "T", url: "", tts: { provider: "edge", voice: "x", rate: "+0%", music_duck: true } }, scenes: [{ sourceLine: 1, title: "S", prose: "", overlays: [], steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }] }] },
        events: [[
          { kind: "scene_start", t: 0, index: 0, title: "S", prose: "" },
          { kind: "step", t: 100, sceneIndex: 0, stepIndex: 1, description: "Open" },
          { kind: "say", t: 150, hash: "a", text: "Click here.", durationMs: 1000, words: [] },
        ]],
        stepIndex: {
          demoId: "tour",
          mp4DurationMs: 3000,
          scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 3000, recordingOffsetMs: 0 }],
          steps: [
            { stepId: "tour:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 100 },
            { stepId: "tour:0:1", sceneIndex: 0, stepIndex: 1, description: "Open", globalStartMs: 100, globalEndMs: 3000 },
          ],
        },
      }],
      embedder: mockEmbedder,
    });

    const chunk = result.chunks.find((c) => c.stepId === "tour:0:1");
    expect(chunk).toBeDefined();
    expect(chunk!.globalStartMs).toBe(100);
    expect(chunk!.globalEndMs).toBe(3000);
  });
});
