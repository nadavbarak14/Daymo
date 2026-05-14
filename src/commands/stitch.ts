// src/commands/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState } from "../core/store.js";
import { stitch, type SceneInput } from "../core/stitch.js";
import { buildStepIndex } from "../core/step-index.js";
import { buildWebVtt, type SayEventForVtt } from "../core/captions-vtt.js";
import { probeDurationMs } from "../core/ffprobe.js";
import type { SayEvent } from "../core/scene-audio.js";
import type { RunnerEvent, SceneForStepIndex } from "../types.js";

export async function stitchCommand(file: string): Promise<void> {
  const demoFile = path.resolve(file);
  const baseDir = path.dirname(demoFile);
  const demoId = path.basename(demoFile, path.extname(demoFile));
  const dotDir = path.join(baseDir, ".daymo");
  const stateFile = path.join(dotDir, "state.json");
  const ttsDir = path.join(dotDir, "tts");

  const ast = parse(await fs.readFile(demoFile, "utf8"));
  const state = await loadState(stateFile, ast.scenes, demoFile);

  const pending: number[] = state.scenes.flatMap((r, i) => r.state === "pending" ? [i + 1] : []);
  if (pending.length > 0) {
    throw new Error(`scenes not captured: ${pending.join(", ")} — run: daymo capture <file> --all`);
  }

  const scenes: SceneInput[] = [];
  const allSceneEvents: RunnerEvent[][] = [];
  const recordingOffsets: number[] = [];
  for (const r of state.scenes) {
    let sayEvents: SayEvent[] = [];
    let recordingOffsetMs = 0;
    let allEvents: RunnerEvent[] = [];
    if (r.eventsPath) {
      try {
        const raw = await fs.readFile(r.eventsPath, "utf8");
        allEvents = JSON.parse(raw) as RunnerEvent[];
        sayEvents = allEvents
          .filter((e): e is Extract<RunnerEvent, { kind: "say" }> => e.kind === "say")
          .map((e) => ({ hash: e.hash, t: e.t, durationMs: e.durationMs, words: e.words ?? [] }));
        const sceneStart = allEvents.find((e): e is Extract<RunnerEvent, { kind: "scene_start" }> => e.kind === "scene_start");
        if (sceneStart && typeof sceneStart.recordingOffsetMs === "number") {
          recordingOffsetMs = sceneStart.recordingOffsetMs;
        }
      } catch {}
    }
    scenes.push({ webm: r.webmPath!, sayEvents, recordingOffsetMs });
    allSceneEvents.push(allEvents);
    recordingOffsets.push(recordingOffsetMs);
  }

  const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  const output = path.join(baseDir, "output.mp4");

  const { mixedScenePaths } = await stitch({
    scenes,
    music,
    output,
    workDir: dotDir,
    ttsDir,
    musicDuck: ast.frontmatter.tts.music_duck,
    onLine: () => {},
  });

  const sceneForStepIndex: SceneForStepIndex[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const durationMs = await probeDurationMs(mixedScenePaths[i]);
    sceneForStepIndex.push({
      sceneIndex: i,
      recordingOffsetMs: recordingOffsets[i],
      trimmedDurationMs: durationMs,
      events: allSceneEvents[i],
    });
  }
  const stepIndex = buildStepIndex(demoId, sceneForStepIndex);
  await fs.writeFile(path.join(dotDir, "step-index.json"), JSON.stringify(stepIndex, null, 2));

  const captions: SayEventForVtt[] = [];
  for (let i = 0; i < allSceneEvents.length; i++) {
    const sceneGlobalStart = stepIndex.scenes[i].globalStartMs;
    const offset = recordingOffsets[i];
    for (const ev of allSceneEvents[i]) {
      if (ev.kind === "say") {
        const globalStartMs = sceneGlobalStart + Math.max(0, ev.t - offset);
        captions.push({ globalStartMs, durationMs: ev.durationMs, text: ev.text });
      }
    }
  }
  await fs.writeFile(path.join(baseDir, "captions.vtt"), buildWebVtt(captions));

  process.stdout.write(`${output}\n`);
}
