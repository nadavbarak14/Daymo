// src/compositor.ts
import { execa } from "execa";
import type { ArtifactPaths } from "./types.js";

export interface FfmpegArgsOpts {
  rawVideo: string;
  music: string | null;
  output: string;
  musicVolume?: number;
}

export function buildFfmpegArgs(opts: FfmpegArgsOpts): string[] {
  const argv: string[] = ["-y", "-i", opts.rawVideo];
  if (opts.music) {
    const vol = (opts.musicVolume ?? 0.4).toFixed(1);
    argv.push(
      "-i", opts.music,
      "-filter_complex", `[1:a]volume=${vol}[m]`,
      "-map", "0:v",
      "-map", "[m]",
      "-c:v", "libx264",
      "-c:a", "aac",
      opts.output,
    );
  } else {
    argv.push("-an", "-map", "0:v", "-c:v", "libx264", opts.output);
  }
  return argv;
}

export interface ComposeOpts {
  artifacts: ArtifactPaths;
  musicSrc: string | null;
  musicVolume?: number;
}

export async function compose(opts: ComposeOpts): Promise<string> {
  const argv = buildFfmpegArgs({
    rawVideo: opts.artifacts.rawVideo,
    music: opts.musicSrc,
    output: opts.artifacts.output,
    musicVolume: opts.musicVolume,
  });
  await execa("ffmpeg", argv);
  return opts.artifacts.output;
}
