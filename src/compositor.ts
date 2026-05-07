// src/compositor.ts
import { execa } from "execa";
import type { ArtifactPaths, DemoAst, TransitionConfig } from "./types.js";
import type { Manifest } from "./manifest.js";
import { buildTransitionFilter } from "./transitions.js";
import { parseDurationMs } from "./parser.js";

export interface BuildArgsOpts {
  paths: ArtifactPaths;
  manifest: Manifest;
  ast: DemoAst;
  musicSrc: string | null;
  musicVolume?: number;
}

function resolveSceneTransition(ast: DemoAst, sceneIndex: number): TransitionConfig {
  const scene = ast.scenes[sceneIndex] as any;
  if (scene.transition) return scene.transition;
  const fm = ast.frontmatter as any;
  const type = fm.defaultTransition ?? "crossfade";
  const durationMs = parseDurationMs(fm.transitionDuration, 500);
  return { type, durationMs };
}

interface VideoSegment {
  label: string;          // ffmpeg filter graph label, e.g. "[s0]"
  durationMs: number;
}

/**
 * Build the video portion of the filter graph for the scenes in continuous mode.
 * Returns the chained filter expressions (semicolon-separated), the final video
 * label to map, and the total duration of the joined output.
 */
function buildVideoFilterGraph(
  manifest: Manifest,
  ast: DemoAst,
): { filter: string; vOut: string; durationMs: number } {
  const segments: string[] = [];
  const sceneClips: VideoSegment[] = manifest.scenes.map((s, i) => {
    const startS = (s.tStartMs / 1000).toFixed(3);
    const endS   = (s.tEndMs   / 1000).toFixed(3);
    const label  = `[s${i}]`;
    segments.push(`[0:v]trim=start=${startS}:end=${endS},setpts=PTS-STARTPTS${label}`);
    return { label, durationMs: s.tEndMs - s.tStartMs };
  });

  if (sceneClips.length === 0) {
    // Degenerate case — no scenes. Return an empty filter; caller should not pass this.
    return { filter: "", vOut: "[0:v]", durationMs: 0 };
  }

  if (sceneClips.length === 1) {
    return {
      filter: segments.join(";"),
      vOut: sceneClips[0].label,
      durationMs: sceneClips[0].durationMs,
    };
  }

  let prevLabel = sceneClips[0].label;
  let prevDuration = sceneClips[0].durationMs;
  for (let i = 1; i < sceneClips.length; i++) {
    const transition = resolveSceneTransition(ast, i);
    const out = `[v${i}]`;
    const r = buildTransitionFilter({
      inLabelA: prevLabel,
      inLabelB: sceneClips[i].label,
      clipADurationMs: prevDuration,
      clipBDurationMs: sceneClips[i].durationMs,
      transition,
      outLabel: out,
    });
    segments.push(r.filter);
    prevLabel = out;
    prevDuration = r.outputDurationMs;
  }

  return {
    filter: segments.join(";"),
    vOut: prevLabel,
    durationMs: prevDuration,
  };
}

export function buildFfmpegArgs(opts: BuildArgsOpts): string[] {
  const argv: string[] = ["-y", "-fflags", "+bitexact", "-i", opts.paths.capture.rawVideo];
  if (opts.musicSrc) argv.push("-fflags", "+bitexact", "-i", opts.musicSrc);

  const g = buildVideoFilterGraph(opts.manifest, opts.ast);
  let filter = g.filter;

  if (opts.musicSrc) {
    const vol = (opts.musicVolume ?? 0.4).toFixed(1);
    const totalS = (g.durationMs / 1000).toFixed(3);
    if (filter) filter += ";";
    filter += `[1:a]volume=${vol},atrim=end=${totalS}[m]`;
  }

  if (filter) argv.push("-filter_complex", filter);

  argv.push("-map", g.vOut);
  if (opts.musicSrc) {
    argv.push(
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
