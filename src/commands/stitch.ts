// src/commands/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState } from "../core/store.js";
import { stitch, type SceneInput } from "../core/stitch.js";
import type { SayEvent } from "../core/scene-audio.js";
import { buildStepIndex } from "../core/step-index.js";
import type { SceneForStepIndex } from "../types.js";

export async function stitchCommand(file: string): Promise<void> {
  const demoFile = path.resolve(file);
  const baseDir = path.dirname(demoFile);
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
  for (const r of state.scenes) {
    let sayEvents: SayEvent[] = [];
    let recordingOffsetMs = 0;
    if (r.eventsPath) {
      try {
        const raw = await fs.readFile(r.eventsPath, "utf8");
        const events: any[] = JSON.parse(raw);
        sayEvents = events
          .filter((e) => e.kind === "say")
          .map((e) => ({ hash: e.hash, t: e.t, durationMs: e.durationMs, words: e.words ?? [] }));
        const sceneStart = events.find((e) => e.kind === "scene_start");
        if (sceneStart && typeof sceneStart.recordingOffsetMs === "number") {
          recordingOffsetMs = sceneStart.recordingOffsetMs;
        }
      } catch {}
    }
    scenes.push({ webm: r.webmPath!, sayEvents, recordingOffsetMs });
  }

  const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  const output = path.join(baseDir, "output.mp4");

  const result = await stitch({
    scenes,
    music,
    output,
    workDir: dotDir,
    ttsDir,
    musicDuck: ast.frontmatter.tts.music_duck,
    onLine: () => {},
  });

  // Build and write step-index.json
  const demoId = path.basename(demoFile, ".demo");
  const sceneInputs: SceneForStepIndex[] = await Promise.all(
    state.scenes.map(async (r, i) => {
      let events: any[] = [];
      if (r.eventsPath) {
        try { events = JSON.parse(await fs.readFile(r.eventsPath, "utf8")); } catch {}
      }
      return {
        sceneIndex: i,
        recordingOffsetMs: result.scenes[i].recordingOffsetMs,
        trimmedDurationMs: result.scenes[i].trimmedDurationMs,
        events,
      };
    })
  );

  const stepIndex = buildStepIndex(demoId, sceneInputs);
  const stepIndexPath = path.join(dotDir, "step-index.json");
  await fs.writeFile(stepIndexPath, JSON.stringify(stepIndex, null, 2));
  process.stdout.write(`${stepIndexPath}\n`);
  process.stdout.write(`${result.outputPath}\n`);
}
