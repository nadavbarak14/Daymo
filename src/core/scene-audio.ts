// src/core/scene-audio.ts
import type { WordTiming } from "../tts/provider.js";

export interface SayEvent {
  hash: string;
  /** Scene-relative ms. Used for BOTH the audio adelay AND the subtitle start
   *  time — single source of truth, guaranteed coupling. */
  t: number;
  durationMs: number;
  words: WordTiming[];
}

/** Quantize a millisecond timestamp to the centisecond grid (10ms). ASS
 *  subtitle timestamps only have centisecond precision; audio adelay accepts
 *  finer ms. Both consumers must round identically, or audio and subtitle
 *  drift by up to 9ms — small but observable as visual misalignment near
 *  word starts. Apply this to ev.t before BOTH the audio and subtitle pass. */
export function quantizeMsToCs(ms: number): number {
  return Math.round(ms / 10) * 10;
}

export interface SceneAudioInput {
  sceneWebm: string;
  output: string;
  sayEvents: SayEvent[];
  ttsDir: string;
  /** Path to a pre-written .ass subtitle file built from the same sayEvents.
   *  When provided, subtitles are burned into the video in the same ffmpeg
   *  call as the audio mix — they share the ev.t origin and cannot drift. */
  subtitlePath?: string;
  /** Trim N ms off the front of the scene webm (input-side `-ss`). The webm
   *  recorder starts capturing at page creation, but events `t=0` is set
   *  after page.goto resolves; this offset closes the gap so audio adelay
   *  and subtitle Dialogue (both in events-time) land on the right frame. */
  videoStartOffsetMs?: number;
}

/** Escape a filesystem path for use inside the ffmpeg subtitles filter.
 *  The colon is the filter argument separator, so on Windows it must be
 *  backslash-escaped. We also normalize backslashes to forward slashes — both
 *  ffmpeg and libass accept them on Windows. */
function escapeSubtitlePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

export function buildSceneAudioArgs(opts: SceneAudioInput): string[] {
  const hasAudio = opts.sayEvents.length > 0;
  const hasSubs = !!opts.subtitlePath;
  const trimMs = opts.videoStartOffsetMs ?? 0;
  if (!hasAudio && !hasSubs) {
    if (trimMs > 0) {
      return ["-y", "-ss", (trimMs / 1000).toFixed(3), "-i", opts.sceneWebm, "-c", "copy", opts.output];
    }
    return ["-y", "-i", opts.sceneWebm, "-c", "copy", opts.output];
  }
  const argv: string[] = ["-y"];
  // Input-side `-ss` seeks the webm to past the page-load prefix BEFORE the
  // filter graph runs. The audio adelay and subtitle Dialogue stay in
  // events-time (which is relative to scene_start = trim point), so all
  // three streams agree.
  if (trimMs > 0) argv.push("-ss", (trimMs / 1000).toFixed(3));
  argv.push("-i", opts.sceneWebm);
  for (const ev of opts.sayEvents) {
    argv.push("-i", `${opts.ttsDir}/${ev.hash}.mp3`);
  }
  const filterChunks: string[] = [];
  // Audio chain: per-say adelay → amix.
  if (hasAudio) {
    const labels: string[] = [];
    for (let i = 0; i < opts.sayEvents.length; i++) {
      const ev = opts.sayEvents[i];
      const inLabel = i + 1; // input index in ffmpeg
      const outLabel = opts.sayEvents.length === 1 ? "narr" : `a${i + 1}`;
      const t = quantizeMsToCs(ev.t);
      filterChunks.push(`[${inLabel}:a]adelay=${t}|${t}[${outLabel}]`);
      labels.push(`[${outLabel}]`);
    }
    if (opts.sayEvents.length > 1) {
      filterChunks.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest[narr]`);
    }
  }
  // Video chain: burn the .ass file. The subtitle Dialogue start times come
  // from the same ev.t values as the audio adelay above — single source.
  if (hasSubs) {
    filterChunks.push(`[0:v]subtitles=filename='${escapeSubtitlePath(opts.subtitlePath!)}'[vout]`);
  }
  argv.push("-filter_complex", filterChunks.join(";"));
  if (hasSubs) {
    argv.push("-map", "[vout]");
  } else {
    argv.push("-map", "0:v");
  }
  if (hasAudio) {
    argv.push("-map", "[narr]");
  }
  if (hasSubs) {
    // Subtitle burn-in requires re-encoding video. Match the source webm
    // container by encoding to vp9 (libvpx-vp9 is slower but preserves the
    // .webm extension and stays compatible with the concat demuxer).
    argv.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1");
  } else {
    argv.push("-c:v", "copy");
  }
  if (hasAudio) {
    argv.push("-c:a", "libopus");
  }
  argv.push(opts.output);
  return argv;
}
