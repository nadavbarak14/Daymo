import type { RunnerEvent, StepIndex } from "../types.js";

export interface ChunkBuilderInput {
  demoId: string;
  demoTitle: string;
  demoDescription: string;
  perSceneEvents: RunnerEvent[][];
  stepIndex: StepIndex;
}

export interface BuiltChunk {
  stepId: string;
  demoId: string;
  sceneIndex: number;
  stepIndex: number;
  globalStartMs: number;
  globalEndMs: number;
  text: string;
}

export function buildChunks(input: ChunkBuilderInput): BuiltChunk[] {
  const { demoTitle, perSceneEvents, stepIndex } = input;

  type Bucket = { says: string[]; overlays: string[]; banners: string[]; description?: string };
  const buckets: Map<string, Bucket> = new Map();
  const keyOf = (si: number, stepI: number) => `${si}:${stepI}`;

  for (let sceneIndex = 0; sceneIndex < perSceneEvents.length; sceneIndex++) {
    const events = perSceneEvents[sceneIndex];
    let currentStepIndex = 0;
    for (const ev of events) {
      if (ev.kind === "step" && ev.sceneIndex === sceneIndex) {
        currentStepIndex = ev.stepIndex;
        // Record the description from the event stream
        const key = keyOf(sceneIndex, ev.stepIndex);
        let bucket = buckets.get(key);
        if (!bucket) { bucket = { says: [], overlays: [], banners: [] }; buckets.set(key, bucket); }
        bucket.description = ev.description;
        continue;
      }
      const key = keyOf(sceneIndex, currentStepIndex);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { says: [], overlays: [], banners: [] }; buckets.set(key, bucket); }
      if (ev.kind === "say") {
        bucket.says.push(ev.text);
      } else if (ev.kind === "overlay") {
        const text = ev.directive && typeof (ev.directive as { text?: string }).text === "string"
          ? (ev.directive as { text: string }).text
          : null;
        if (text) bucket.overlays.push(text);
      } else if (ev.kind === "fx" && ev.method === "banner") {
        const bannerText = Array.isArray(ev.args) && typeof ev.args[0] === "string" ? (ev.args[0] as string) : null;
        if (bannerText) bucket.banners.push(bannerText);
      }
    }
  }

  const sceneProse: Map<number, string> = new Map();
  const sceneTitles: Map<number, string> = new Map();
  for (let sceneIndex = 0; sceneIndex < perSceneEvents.length; sceneIndex++) {
    const start = perSceneEvents[sceneIndex].find(
      (e): e is Extract<RunnerEvent, { kind: "scene_start" }> => e.kind === "scene_start"
    );
    if (start?.prose) sceneProse.set(sceneIndex, start.prose);
    sceneTitles.set(sceneIndex, start?.title ?? "");
  }

  const chunks: BuiltChunk[] = [];
  for (const step of stepIndex.steps) {
    const bucket = buckets.get(keyOf(step.sceneIndex, step.stepIndex)) ?? { says: [], overlays: [], banners: [] };
    const proseForThisStep = step.stepIndex === 0 ? sceneProse.get(step.sceneIndex) ?? "" : "";
    const body = [
      ...bucket.says,
      proseForThisStep ? proseForThisStep : null,
      ...bucket.overlays,
      ...bucket.banners,
    ].filter((s): s is string => Boolean(s && s.trim()));

    if (body.length === 0) continue;

    const sceneTitle = sceneTitles.get(step.sceneIndex) ?? "";
    // Prefer the description captured from the event stream; fall back to step-index
    const stepDescription = bucket.description ?? step.description;
    const text = [
      `[Demo] ${demoTitle}`,
      `[Scene] ${sceneTitle}`,
      `[Step] ${stepDescription}`,
      ...body,
    ].join("\n");

    chunks.push({
      stepId: step.stepId,
      demoId: step.stepId.split(":")[0],
      sceneIndex: step.sceneIndex,
      stepIndex: step.stepIndex,
      globalStartMs: step.globalStartMs,
      globalEndMs: step.globalEndMs,
      text,
    });
  }
  return chunks;
}
