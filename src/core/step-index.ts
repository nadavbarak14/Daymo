import type {
  RunnerEvent,
  SceneForStepIndex,
  StepIndex,
  StepIndexEntry,
  SceneIndexEntry,
} from "../types.js";

/** Pure function: given per-scene events + measured trimmed durations,
 *  produce a global step index keyed against the final stitched mp4.
 *  Scenes are processed in input order. */
export function buildStepIndex(demoId: string, scenes: SceneForStepIndex[]): StepIndex {
  const sceneEntries: SceneIndexEntry[] = [];
  const stepEntries: StepIndexEntry[] = [];
  let cursorMs = 0;

  for (const sc of scenes) {
    const sceneGlobalStart = cursorMs;
    const sceneGlobalEnd = sceneGlobalStart + sc.trimmedDurationMs;
    sceneEntries.push({
      sceneIndex: sc.sceneIndex,
      globalStartMs: sceneGlobalStart,
      globalEndMs: sceneGlobalEnd,
      recordingOffsetMs: sc.recordingOffsetMs,
    });

    const explicit = sc.events.filter((e): e is Extract<RunnerEvent, { kind: "step" }> => e.kind === "step");

    const preambleStart = sceneGlobalStart;
    const firstExplicitGlobal = explicit.length > 0
      ? sceneGlobalStart + Math.max(0, explicit[0].t - sc.recordingOffsetMs)
      : sceneGlobalEnd;

    stepEntries.push({
      stepId: `${demoId}:${sc.sceneIndex}:0`,
      sceneIndex: sc.sceneIndex,
      stepIndex: 0,
      description: "(preamble)",
      globalStartMs: preambleStart,
      globalEndMs: firstExplicitGlobal,
    });

    for (let i = 0; i < explicit.length; i++) {
      const ev = explicit[i];
      const globalStart = sceneGlobalStart + Math.max(0, ev.t - sc.recordingOffsetMs);
      const nextEvent = explicit[i + 1];
      const globalEnd = nextEvent
        ? sceneGlobalStart + Math.max(0, nextEvent.t - sc.recordingOffsetMs)
        : sceneGlobalEnd;
      stepEntries.push({
        stepId: `${demoId}:${sc.sceneIndex}:${ev.stepIndex}`,
        sceneIndex: sc.sceneIndex,
        stepIndex: ev.stepIndex,
        description: ev.description,
        globalStartMs: globalStart,
        globalEndMs: globalEnd,
      });
    }

    cursorMs = sceneGlobalEnd;
  }

  return {
    demoId,
    mp4DurationMs: cursorMs,
    scenes: sceneEntries,
    steps: stepEntries,
  };
}
