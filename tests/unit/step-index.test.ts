import { describe, it, expect } from "vitest";
import { buildStepIndex } from "../../src/core/step-index.js";
import type { SceneForStepIndex, RunnerEvent } from "../../src/types.js";

const sceneStart = (i: number, recordingOffsetMs?: number): RunnerEvent => ({
  kind: "scene_start",
  t: 0,
  index: i,
  title: `scene ${i}`,
  prose: "",
  recordingOffsetMs,
});
const sceneEnd = (i: number, t: number): RunnerEvent => ({ kind: "scene_end", t, index: i });
const step = (sceneIndex: number, stepIndex: number, t: number, description: string): RunnerEvent => ({
  kind: "step", t, sceneIndex, stepIndex, description,
});

describe("buildStepIndex", () => {
  it("produces one scene entry per input scene with cumulative offsets", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 5000, events: [sceneStart(0), sceneEnd(0, 5000)] },
      { sceneIndex: 1, recordingOffsetMs: 0, trimmedDurationMs: 7000, events: [sceneStart(1), sceneEnd(1, 7000)] },
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.scenes).toHaveLength(2);
    expect(idx.scenes[0]).toMatchObject({ sceneIndex: 0, globalStartMs: 0, globalEndMs: 5000 });
    expect(idx.scenes[1]).toMatchObject({ sceneIndex: 1, globalStartMs: 5000, globalEndMs: 12000 });
    expect(idx.mp4DurationMs).toBe(12000);
  });

  it("emits one implicit preamble per scene even with no explicit step events", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 4000, events: [sceneStart(0), sceneEnd(0, 4000)] },
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps).toHaveLength(1);
    expect(idx.steps[0]).toMatchObject({
      stepId: "d1:0:0",
      stepIndex: 0,
      description: "(preamble)",
      globalStartMs: 0,
      globalEndMs: 4000,
    });
  });

  it("places explicit steps after the preamble; preamble ends where first step starts", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 10000, events: [
        sceneStart(0),
        step(0, 1, 3000, "First step"),
        step(0, 2, 6000, "Second step"),
        sceneEnd(0, 10000),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps).toHaveLength(3);
    expect(idx.steps[0]).toMatchObject({ stepId: "d1:0:0", globalStartMs: 0, globalEndMs: 3000 });
    expect(idx.steps[1]).toMatchObject({ stepId: "d1:0:1", description: "First step", globalStartMs: 3000, globalEndMs: 6000 });
    expect(idx.steps[2]).toMatchObject({ stepId: "d1:0:2", description: "Second step", globalStartMs: 6000, globalEndMs: 10000 });
  });

  it("subtracts recordingOffsetMs from step.t when computing global timestamps", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 500, trimmedDurationMs: 9500, events: [
        sceneStart(0, 500),
        step(0, 1, 2500, "First step"),
        sceneEnd(0, 10000),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps[0].globalEndMs).toBe(2000);
    expect(idx.steps[1].globalStartMs).toBe(2000);
    expect(idx.steps[1].globalEndMs).toBe(9500);
  });

  it("handles missing recordingOffsetMs as 0", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 5000, events: [
        sceneStart(0, undefined),
        step(0, 1, 1000, "Only step"),
        sceneEnd(0, 5000),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps[1].globalStartMs).toBe(1000);
    expect(idx.scenes[0].recordingOffsetMs).toBe(0);
  });

  it("uses event order (not stepIndex order) for chronological computation", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 8000, events: [
        sceneStart(0),
        step(0, 1, 2000, "Step one"),
        step(0, 2, 5000, "Step two"),
        sceneEnd(0, 8000),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps.map(s => s.stepId)).toEqual(["d1:0:0", "d1:0:1", "d1:0:2"]);
  });

  it("composes multi-scene global timestamps correctly", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 100, trimmedDurationMs: 5000, events: [
        sceneStart(0, 100),
        step(0, 1, 1100, "S0 step 1"),
        sceneEnd(0, 5100),
      ]},
      { sceneIndex: 1, recordingOffsetMs: 200, trimmedDurationMs: 4000, events: [
        sceneStart(1, 200),
        step(1, 1, 1200, "S1 step 1"),
        sceneEnd(1, 4200),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps.find(s => s.stepId === "d1:0:1")?.globalStartMs).toBe(1000);
    expect(idx.steps.find(s => s.stepId === "d1:1:1")?.globalStartMs).toBe(6000);
    expect(idx.mp4DurationMs).toBe(9000);
  });
});
