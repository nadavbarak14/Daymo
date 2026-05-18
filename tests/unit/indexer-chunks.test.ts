import { describe, it, expect } from "vitest";
import { buildChunkTexts } from "../../src/core/indexer-chunks.js";
import type { RunnerEvent } from "../../src/types.js";

describe("buildChunkTexts", () => {
  it("creates a single preamble chunk for a scene with one fx.say", () => {
    const result = buildChunkTexts({
      demoId: "tour",
      demoTitle: "Loomly Tour",
      scenes: [{
        sceneIndex: 0,
        sceneTitle: "Welcome",
        sceneProse: "The dashboard greets the user.",
        events: [
          { kind: "scene_start", t: 0, index: 0, title: "Welcome", prose: "" },
          { kind: "say", t: 100, hash: "abc", text: "Welcome back, Alex.", durationMs: 1500, words: [] },
          { kind: "scene_end", t: 1600, index: 0 },
        ] as RunnerEvent[],
      }],
    });

    expect(result).toEqual([{
      stepId: "tour:0:0",
      sceneIndex: 0,
      stepIndex: 0,
      text:
        "[Demo] Loomly Tour\n" +
        "[Scene] Welcome\n" +
        "[Step] (preamble)\n" +
        "Welcome back, Alex.\n" +
        "The dashboard greets the user.",
      keywords: expect.any(Array),
    }]);
  });

  it("buckets fx.say events into explicit steps by t-order", () => {
    const result = buildChunkTexts({
      demoId: "t",
      demoTitle: "T",
      scenes: [{
        sceneIndex: 0,
        sceneTitle: "S",
        sceneProse: "",
        events: [
          { kind: "scene_start", t: 0, index: 0, title: "S", prose: "" },
          { kind: "step", t: 100, sceneIndex: 0, stepIndex: 1, description: "Open" },
          { kind: "say", t: 150, hash: "a", text: "Click here.", durationMs: 1000, words: [] },
          { kind: "step", t: 1500, sceneIndex: 0, stepIndex: 2, description: "Submit" },
          { kind: "say", t: 1600, hash: "b", text: "Press submit.", durationMs: 1000, words: [] },
        ] as RunnerEvent[],
      }],
    });
    expect(result.map((c) => c.stepId)).toEqual(["t:0:1", "t:0:2"]);
    expect(result[0].text).toContain("Click here.");
    expect(result[1].text).toContain("Press submit.");
  });

  it("skips chunks that contain only headers (mechanics-only step)", () => {
    const result = buildChunkTexts({
      demoId: "t",
      demoTitle: "T",
      scenes: [{
        sceneIndex: 0,
        sceneTitle: "S",
        sceneProse: "",
        events: [
          { kind: "scene_start", t: 0, index: 0, title: "S", prose: "" },
          { kind: "step", t: 100, sceneIndex: 0, stepIndex: 1, description: "Click only" },
          { kind: "fx", t: 110, method: "cursorTo", args: [".btn"] },
        ] as RunnerEvent[],
      }],
    });
    expect(result).toEqual([]);
  });

  it("extracts keywords, lowercased and stopwords removed", () => {
    const result = buildChunkTexts({
      demoId: "t",
      demoTitle: "T",
      scenes: [{
        sceneIndex: 0,
        sceneTitle: "Welcome",
        sceneProse: "The user creates a new project.",
        events: [
          { kind: "scene_start", t: 0, index: 0, title: "Welcome", prose: "" },
          { kind: "say", t: 100, hash: "a", text: "Welcome.", durationMs: 500, words: [] },
        ] as RunnerEvent[],
      }],
    });
    const kw = result[0].keywords;
    expect(kw).toContain("welcome");
    expect(kw).toContain("user");
    expect(kw).toContain("creates");
    expect(kw).toContain("project");
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("a");
  });
});
