// src/core/scene-audio.ts
export interface SayEvent { hash: string; t: number; }

export interface SceneAudioInput {
  sceneWebm: string;
  output: string;
  sayEvents: SayEvent[];
  ttsDir: string;
}

export function buildSceneAudioArgs(opts: SceneAudioInput): string[] {
  if (opts.sayEvents.length === 0) {
    return ["-y", "-i", opts.sceneWebm, "-c", "copy", opts.output];
  }
  const argv: string[] = ["-y", "-i", opts.sceneWebm];
  for (const ev of opts.sayEvents) {
    argv.push("-i", `${opts.ttsDir}/${ev.hash}.mp3`);
  }
  const labels: string[] = [];
  const filterChunks: string[] = [];
  for (let i = 0; i < opts.sayEvents.length; i++) {
    const ev = opts.sayEvents[i];
    const inLabel = i + 1; // input index in ffmpeg
    const outLabel = opts.sayEvents.length === 1 ? "narr" : `a${i + 1}`;
    filterChunks.push(`[${inLabel}:a]adelay=${ev.t}|${ev.t}[${outLabel}]`);
    labels.push(`[${outLabel}]`);
  }
  if (opts.sayEvents.length > 1) {
    filterChunks.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest[narr]`);
  }
  argv.push(
    "-filter_complex", filterChunks.join(";"),
    "-map", "0:v",
    "-map", "[narr]",
    "-c:v", "copy",
    "-c:a", "libopus",
    opts.output,
  );
  return argv;
}
