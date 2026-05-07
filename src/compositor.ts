// src/compositor.ts
import { execa } from "execa";
import type { ArtifactPaths, DemoAst } from "./types.js";
import type { Manifest } from "./manifest.js";

export interface BuildArgsOpts {
  paths: ArtifactPaths;
  manifest: Manifest;
  ast: DemoAst;
  musicSrc: string | null;
  musicVolume?: number;
}

export function buildFfmpegArgs(opts: BuildArgsOpts): string[] {
  // v0.1-parity: a single -i input, optional music mix, libx264 + aac.
  // Phase 4–6 will replace this with a full filter graph builder.
  // -fflags +bitexact before each -i suppresses non-deterministic container metadata.
  const argv: string[] = ["-y", "-fflags", "+bitexact", "-i", opts.paths.capture.rawVideo];
  if (opts.musicSrc) {
    const vol = (opts.musicVolume ?? 0.4).toFixed(1);
    argv.push(
      "-fflags", "+bitexact",
      "-i", opts.musicSrc,
      "-filter_complex", `[1:a]volume=${vol}[m]`,
      "-map", "0:v",
      "-map", "[m]",
      "-c:v", "libx264",
      "-flags:v", "+bitexact",
      "-c:a", "aac",
      "-flags:a", "+bitexact",
      "-map_metadata", "-1",
      "-shortest",
      opts.paths.output,
    );
  } else {
    argv.push(
      "-an",
      "-map", "0:v",
      "-c:v", "libx264",
      "-flags:v", "+bitexact",
      "-map_metadata", "-1",
      opts.paths.output,
    );
  }
  return argv;
}

export interface ComposeOpts {
  paths: ArtifactPaths;
  manifest: Manifest;
  ast: DemoAst;
  baseDir: string;
  musicSrc: string | null;
  musicVolume?: number;
}

export async function compose(opts: ComposeOpts): Promise<string> {
  const argv = buildFfmpegArgs(opts);
  await execa("ffmpeg", argv);
  return opts.paths.output;
}
