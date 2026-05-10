// src/core/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { buildConcatList, buildStitchArgs } from "./concat.js";
import { buildSceneAudioArgs, type SayEvent } from "./scene-audio.js";

export interface SceneInput {
  webm: string;
  sayEvents: SayEvent[];   // [] if scene has no narration
}

export interface StitchOpts {
  scenes: SceneInput[];
  music: string | null;
  output: string;
  workDir: string;
  ttsDir: string;
  musicVolume?: number;
  musicDuck?: boolean;
  onLine?: (line: string) => void;
}

export async function stitch(opts: StitchOpts): Promise<string> {
  // Per-scene audio mix
  const mixedScenes: string[] = [];
  for (let i = 0; i < opts.scenes.length; i++) {
    const sc = opts.scenes[i];
    if (sc.sayEvents.length === 0) {
      mixedScenes.push(sc.webm);
      continue;
    }
    // Verify TTS files exist before invoking ffmpeg
    for (const ev of sc.sayEvents) {
      const f = path.join(opts.ttsDir, `${ev.hash}.mp3`);
      try { await fs.access(f); }
      catch { throw new Error(`missing TTS audio for scene ${i + 1}: ${ev.hash}. Re-run: daymo capture <file> --scene ${i + 1}`); }
    }
    const out = path.join(opts.workDir, `scene-${String(i + 1).padStart(3, "0")}.with-audio.webm`);
    await execa("ffmpeg", buildSceneAudioArgs({
      sceneWebm: sc.webm,
      output: out,
      sayEvents: sc.sayEvents,
      ttsDir: opts.ttsDir,
    }));
    mixedScenes.push(out);
  }

  const listFile = path.join(opts.workDir, "concat-list.txt");
  await fs.writeFile(listFile, buildConcatList(mixedScenes));
  const args = buildStitchArgs({
    listFile,
    music: opts.music,
    output: opts.output,
    musicVolume: opts.musicVolume,
    musicDuck: opts.musicDuck,
  });
  const proc = execa("ffmpeg", args);
  if (opts.onLine && proc.stderr) {
    proc.stderr.setEncoding("utf8");
    let buf = "";
    proc.stderr.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) opts.onLine!(line);
    });
  }
  await proc;
  return opts.output;
}
