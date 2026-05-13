// src/core/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { buildConcatList, buildStitchArgs } from "./concat.js";
import { buildSceneAudioArgs, type SayEvent } from "./scene-audio.js";
import { buildAss } from "./subtitles.js";

export interface SceneInput {
  webm: string;
  sayEvents: SayEvent[];   // [] if scene has no narration
  /** Trim N ms off the front of the webm before mixing audio/subtitles.
   *  Carries the page-load prefix that recordVideo captured before events
   *  `t=0`. Audio adelay + subtitle Dialogue use events-time, so the webm
   *  must be trimmed by this offset for them to align. */
  recordingOffsetMs?: number;
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

/** Spawn ffmpeg and forward each stderr line (prefixed) to opts.onLine.
 *  Returns a promise that resolves when ffmpeg exits cleanly, rejects on
 *  non-zero exit. Mirrors the original `await execa(...)` semantics. */
function runFfmpegWithLines(args: string[], prefix: string, onLine?: (line: string) => void): Promise<void> {
  const proc = execa("ffmpeg", args);
  if (onLine && proc.stderr) {
    proc.stderr.setEncoding("utf8");
    let buf = "";
    proc.stderr.on("data", (chunk: string) => {
      buf += chunk;
      // ffmpeg progress lines end with a lone \r (so the terminal overwrites
      // in place) — split on \r and \n alike so we surface them in real time.
      const lines = buf.split(/\r\n|\r|\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) onLine(`${prefix} ${line}`);
      }
    });
  }
  return proc.then(() => undefined);
}

export async function stitch(opts: StitchOpts): Promise<string> {
  // Per-scene audio mix
  const mixedScenes: string[] = [];
  for (let i = 0; i < opts.scenes.length; i++) {
    const sc = opts.scenes[i];
    const trimMs = sc.recordingOffsetMs ?? 0;
    const sceneTag = `[scene ${i + 1}/${opts.scenes.length}]`;
    const tag = String(i + 1).padStart(3, "0");
    if (sc.sayEvents.length === 0) {
      // No narration: if we still need to trim the page-load prefix, run a
      // copy-mode ffmpeg pass; otherwise pass through.
      if (trimMs > 0) {
        const trimmed = path.join(opts.workDir, `scene-${tag}.trimmed.webm`);
        opts.onLine?.(`${sceneTag} trimming page-load prefix (${trimMs}ms)…`);
        await runFfmpegWithLines([
          "-y",
          "-ss", (trimMs / 1000).toFixed(3),
          "-i", sc.webm,
          "-c", "copy",
          trimmed,
        ], sceneTag, opts.onLine);
        mixedScenes.push(trimmed);
      } else {
        mixedScenes.push(sc.webm);
      }
      continue;
    }
    // Verify TTS files exist before invoking ffmpeg
    for (const ev of sc.sayEvents) {
      const f = path.join(opts.ttsDir, `${ev.hash}.mp3`);
      try { await fs.access(f); }
      catch { throw new Error(`missing TTS audio for scene ${i + 1}: ${ev.hash}. Re-run: daymo capture <file> --scene ${i + 1}`); }
    }
    const out = path.join(opts.workDir, `scene-${tag}.with-audio.webm`);
    // Write the .ass subtitle file from the SAME sayEvents that drive the
    // audio mix. ffmpeg consumes both in one pass — they share ev.t, so
    // audio and subtitle cannot drift apart.
    const subtitlePath = path.join(opts.workDir, `scene-${tag}.ass`);
    const ass = buildAss({ events: sc.sayEvents.map((ev) => ({ t: ev.t, durationMs: ev.durationMs, words: ev.words })) });
    await fs.writeFile(subtitlePath, ass);
    opts.onLine?.(`${sceneTag} mixing narration + subtitles…`);
    await runFfmpegWithLines(buildSceneAudioArgs({
      sceneWebm: sc.webm,
      output: out,
      sayEvents: sc.sayEvents,
      ttsDir: opts.ttsDir,
      subtitlePath,
      videoStartOffsetMs: trimMs,
    }), sceneTag, opts.onLine);
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
  opts.onLine?.("[final] concatenating scenes + mixing music…");
  await runFfmpegWithLines(args, "[final]", opts.onLine);
  return opts.output;
}
