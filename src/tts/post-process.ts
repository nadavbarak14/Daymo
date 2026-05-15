// src/tts/post-process.ts
//
// Edge TTS (msedge-tts) reports the first word's WordBoundary `Offset` ahead
// of where audio actually starts — typically at 100ms even though the mp3 has
// ~180-200ms of leading silence. Trusting that offset puts the karaoke
// highlight ~100ms ahead of audible speech on the first word of every line.
//
// We don't modify the audio (re-encoding adds mp3 encoder padding that brings
// its own ~50ms uncertainty). Instead we measure the audio's true leading
// silence with ffmpeg silencedetect and shift every word timing forward so
// the first word's startMs equals the measured silence end. Subsequent words
// move by the same delta, which keeps relative spacing intact — intra-phrase
// boundaries from Edge TTS are within ~30ms of audible reality, so a uniform
// shift keeps every word within perceptual sync.
import { execa } from "execa";
import type { WordTiming } from "./provider.js";

export interface ShiftOpts {
  /** silencedetect threshold. Default -40dB matches perceived onset well
   *  without overfitting to noise floor. */
  threshold?: string;
  /** Minimum silence duration to qualify as leading silence (sec). Default 50ms. */
  minSilenceSec?: number;
}

/** Detect the end of the leading silence in `audio` (ms). Returns 0 when no
 *  leading silence is present (i.e. silencedetect didn't report a run that
 *  starts at t=0). */
async function detectLeadingSilenceMs(audio: Buffer, threshold: string, minSilenceSec: number): Promise<number> {
  const proc = await execa("ffmpeg", [
    "-hide_banner",
    "-loglevel", "info",
    "-i", "pipe:0",
    "-af", `silencedetect=noise=${threshold}:duration=${minSilenceSec.toFixed(3)}`,
    "-f", "null",
    "-",
  ], {
    input: audio,
    reject: false,
    stderr: "pipe",
    stdout: "ignore",
  });
  const stderr = String(proc.stderr ?? "");
  // silencedetect emits "silence_start: 0" then "silence_end: <sec>" for runs
  // that begin at t=0. If the first reported start is > 0, no leading silence.
  const startMatch = stderr.match(/silence_start:\s*([0-9.]+)/);
  if (!startMatch || parseFloat(startMatch[1]) > 0.01) return 0;
  const endMatch = stderr.match(/silence_end:\s*([0-9.]+)/);
  if (!endMatch) return 0;
  return Math.round(parseFloat(endMatch[1]) * 1000);
}

/** Shift all word timings forward by `silenceEnd - firstWord.startMs` so the
 *  first word boundary lands on the first audible sample. Audio buffer is
 *  returned unchanged — only the timings move. */
export async function alignTimingsToAudio(
  audio: Buffer,
  timings: WordTiming[],
  opts: ShiftOpts = {},
): Promise<{ audio: Buffer; timings: WordTiming[]; shiftMs: number }> {
  if (timings.length === 0) return { audio, timings, shiftMs: 0 };
  const threshold = opts.threshold ?? "-40dB";
  const minSilenceSec = opts.minSilenceSec ?? 0.05;
  const silenceEndMs = await detectLeadingSilenceMs(audio, threshold, minSilenceSec);
  const correction = silenceEndMs - timings[0].startMs;
  if (correction <= 0) return { audio, timings, shiftMs: 0 };
  const shifted: WordTiming[] = timings.map((t) => ({
    word: t.word,
    startMs: t.startMs + correction,
    endMs: t.endMs + correction,
  }));
  return { audio, timings: shifted, shiftMs: correction };
}
