import { describe, it, expect } from "vitest";
import { buildChunks, type ChunkBuilderInput } from "../../src/indexer/chunk-builder.js";
import type { RunnerEvent, StepIndex } from "../../src/types.js";

function evScene(i: number, title: string, prose = ""): RunnerEvent {
  return { kind: "scene_start", t: 0, index: i, title, prose };
}
function evSceneEnd(i: number, t: number): RunnerEvent { return { kind: "scene_end", t, index: i }; }
function evStep(sceneIndex: number, stepIndex: number, t: number, description: string): RunnerEvent {
  return { kind: "step", t, sceneIndex, stepIndex, description };
}
function evSay(t: number, text: string): RunnerEvent {
  return { kind: "say", t, hash: "x", text, durationMs: 1000, words: [] };
}

function mkInput(events: RunnerEvent[], stepIndex: Partial<StepIndex> = {}): ChunkBuilderInput {
  return {
    demoId: "d1",
    demoTitle: "D1 Tour",
    demoDescription: "Tour of D1",
    perSceneEvents: [events],
    stepIndex: {
      demoId: "d1",
      mp4DurationMs: 10000,
      scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 10000, recordingOffsetMs: 0 }],
      steps: [
        { stepId: "d1:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 3000 },
        { stepId: "d1:0:1", sceneIndex: 0, stepIndex: 1, description: "Step one", globalStartMs: 3000, globalEndMs: 10000 },
      ],
      ...stepIndex,
    } as StepIndex,
  };
}

describe("buildChunks", () => {
  it("emits one chunk per step in the step-index, with stepId/timestamps copied from it", () => {
    const events = [
      evScene(0, "Welcome"),
      evSay(500, "Preamble narration."),
      evStep(0, 1, 3000, "Step one"),
      evSay(3500, "Step one narration."),
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    expect(chunks.map(c => c.stepId)).toEqual(["d1:0:0", "d1:0:1"]);
    expect(chunks[0]).toMatchObject({ globalStartMs: 0, globalEndMs: 3000 });
    expect(chunks[1]).toMatchObject({ globalStartMs: 3000, globalEndMs: 10000 });
  });

  it("attributes each say event to the most-recent step event in the same scene", () => {
    const events = [
      evScene(0, "Welcome"),
      evSay(500, "Hello from the preamble."),
      evStep(0, 1, 3000, "Open the dialog"),
      evSay(3500, "Click the new project button."),
      evSay(4000, "It opens a modal."),
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    expect(chunks[0].text).toContain("Hello from the preamble.");
    expect(chunks[0].text).not.toContain("Click the new project button.");
    expect(chunks[1].text).toContain("Click the new project button.");
    expect(chunks[1].text).toContain("It opens a modal.");
  });

  it("includes scene prose only in the chunk for stepIndex=0 (preamble)", () => {
    const events = [
      evScene(0, "Welcome", "This scene introduces the dashboard."),
      evSay(500, "Intro narration."),
      evStep(0, 1, 3000, "Open the dialog"),
      evSay(3500, "Step narration."),
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    expect(chunks[0].text).toContain("This scene introduces the dashboard.");
    expect(chunks[1].text).not.toContain("This scene introduces the dashboard.");
  });

  it("formats canonical text with [Demo]/[Scene]/[Step] headers and inline narration", () => {
    const events = [
      evScene(0, "Welcome"),
      evSay(500, "Intro narration."),
      evStep(0, 1, 3000, "Open the dialog"),
      evSay(3500, "Click here."),
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    expect(chunks[1].text).toBe([
      "[Demo] D1 Tour",
      "[Scene] Welcome",
      "[Step] Open the dialog",
      "Click here.",
    ].join("\n"));
  });

  it("uses '(preamble)' as the step header for stepIndex=0", () => {
    const events = [evScene(0, "Welcome"), evSay(500, "Hi."), evSceneEnd(0, 10000)];
    const chunks = buildChunks(mkInput(events, { steps: [
      { stepId: "d1:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 10000 },
    ]}));
    expect(chunks[0].text).toContain("[Step] (preamble)");
  });

  it("skips chunks whose body contains only headers and no narration / prose / overlay", () => {
    const events = [
      evScene(0, "Welcome"),
      evStep(0, 1, 3000, "Pure mechanics"),
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    // No say events anywhere, no prose — both chunks should be skipped.
    expect(chunks).toHaveLength(0);
  });

  it("emits the preamble chunk only if the scene has prose or the preamble bucket has any narration", () => {
    const events = [evScene(0, "Welcome"), evSceneEnd(0, 5000)];
    const chunks = buildChunks(mkInput(events, { steps: [
      { stepId: "d1:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 5000 },
    ]}));
    expect(chunks).toHaveLength(0);
  });
});
