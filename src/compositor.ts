// src/compositor.ts
import { execa } from "execa";
import type { ArtifactPaths, DemoAst, TransitionConfig } from "./types.js";
import type { Manifest } from "./manifest.js";
import { buildTransitionFilter } from "./transitions.js";
import { parseDurationMs } from "./parser.js";
import { resolveIntroConfig, resolveOutroConfig, renderSlate } from "./slates.js";

export interface BuildArgsOpts {
  paths: ArtifactPaths;
  manifest: Manifest;
  ast: DemoAst;
  musicSrc: string | null;
  musicVolume?: number;
  slatePaths?: { intro: string | null; outro: string | null };
  slateConfigs?: { intro?: { durationMs: number }; outro?: { durationMs: number } };
}

function resolveSceneTransition(ast: DemoAst, sceneIndex: number): TransitionConfig {
  const scene = ast.scenes[sceneIndex] as any;
  if (scene.transition) return scene.transition;
  const fm = ast.frontmatter as any;
  const type = fm.defaultTransition ?? "crossfade";
  const durationMs = parseDurationMs(fm.transitionDuration, 500);
  return { type, durationMs };
}

function defaultTransition(ast: DemoAst): TransitionConfig {
  const fm = ast.frontmatter as any;
  return { type: fm.defaultTransition ?? "crossfade", durationMs: parseDurationMs(fm.transitionDuration, 500) };
}

/**
 * Build the video portion of the filter graph for the scenes in continuous mode,
 * optionally prepending an intro slate and appending an outro slate.
 * Returns the chained filter expressions (semicolon-separated), the final video
 * label to map, the total duration of the joined output, and the total number of
 * inputs consumed (so the caller knows what index to use for music etc.).
 */
function buildVideoFilterGraph(
  manifest: Manifest,
  ast: DemoAst,
  slatePaths?: { intro: string | null; outro: string | null },
  slateConfigs?: { intro?: { durationMs: number }; outro?: { durationMs: number } },
  hasMusic = false,
): { filter: string; vOut: string; durationMs: number; numInputs: number } {
  const segments: string[] = [];

  // Input layout: [0] page.webm, [1] music?, [N] intro?, [N+1] outro?
  let nextInput = 1;
  if (hasMusic) nextInput++;
  const introInput = slatePaths?.intro ? nextInput++ : -1;
  const outroInput = slatePaths?.outro ? nextInput++ : -1;

  type Step = { label: string; durationMs: number; isScene: boolean; sceneIndex: number };
  const steps: Step[] = [];

  // When slates are present we need all streams on the same timebase (xfade requires it).
  // The webm scenes have timebase 1/1000 after trim; h264 slates use 1/12800.
  // Normalise everything to 25 fps / 1/1000 tb only when slates are in use.
  const hasSlates = introInput >= 0 || outroInput >= 0;
  const normScene = hasSlates ? ",fps=fps=25,settb=1/1000" : "";
  const normSlate = "fps=fps=25,settb=1/1000,";

  if (introInput >= 0) {
    segments.push(`[${introInput}:v]${normSlate}setpts=PTS-STARTPTS[intro]`);
    steps.push({ label: "[intro]", durationMs: slateConfigs?.intro?.durationMs ?? 2500, isScene: false, sceneIndex: -1 });
  }

  manifest.scenes.forEach((s, i) => {
    const startS = (s.tStartMs / 1000).toFixed(3);
    const endS   = (s.tEndMs   / 1000).toFixed(3);
    const lbl    = `[s${i}]`;
    segments.push(`[0:v]trim=start=${startS}:end=${endS},setpts=PTS-STARTPTS${normScene}${lbl}`);
    steps.push({ label: lbl, durationMs: s.tEndMs - s.tStartMs, isScene: true, sceneIndex: i });
  });

  if (outroInput >= 0) {
    segments.push(`[${outroInput}:v]${normSlate}setpts=PTS-STARTPTS[outro]`);
    steps.push({ label: "[outro]", durationMs: slateConfigs?.outro?.durationMs ?? 2000, isScene: false, sceneIndex: -1 });
  }

  if (steps.length === 0) {
    return { filter: "", vOut: "[0:v]", durationMs: 0, numInputs: nextInput };
  }

  if (steps.length === 1) {
    return {
      filter: segments.join(";"),
      vOut: steps[0].label,
      durationMs: steps[0].durationMs,
      numInputs: nextInput,
    };
  }

  let prevLabel = steps[0].label;
  let prevDuration = steps[0].durationMs;
  for (let i = 1; i < steps.length; i++) {
    const t: TransitionConfig = steps[i].isScene
      ? resolveSceneTransition(ast, steps[i].sceneIndex)
      : defaultTransition(ast);
    const out = `[v${i}]`;
    const r = buildTransitionFilter({
      inLabelA: prevLabel,
      inLabelB: steps[i].label,
      clipADurationMs: prevDuration,
      clipBDurationMs: steps[i].durationMs,
      transition: t,
      outLabel: out,
    });
    segments.push(r.filter);
    prevLabel = out;
    prevDuration = r.outputDurationMs;
  }

  return { filter: segments.join(";"), vOut: prevLabel, durationMs: prevDuration, numInputs: nextInput };
}

export function buildFfmpegArgs(opts: BuildArgsOpts): string[] {
  const argv: string[] = ["-y", "-fflags", "+bitexact", "-i", opts.paths.capture.rawVideo];
  if (opts.musicSrc) argv.push("-fflags", "+bitexact", "-i", opts.musicSrc);
  if (opts.slatePaths?.intro) argv.push("-fflags", "+bitexact", "-i", opts.slatePaths.intro);
  if (opts.slatePaths?.outro) argv.push("-fflags", "+bitexact", "-i", opts.slatePaths.outro);

  const g = buildVideoFilterGraph(opts.manifest, opts.ast, opts.slatePaths, opts.slateConfigs, !!opts.musicSrc);
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
  const fm = opts.ast.frontmatter as any;
  const introCfg = resolveIntroConfig(opts.ast.frontmatter, fm.intro);
  const outroCfg = resolveOutroConfig(opts.ast.frontmatter, fm.outro);

  const slatePaths: { intro: string | null; outro: string | null } = { intro: null, outro: null };

  if (introCfg) {
    slatePaths.intro = await renderSlate({
      slate: introCfg,
      viewport: opts.manifest.viewport,
      outDir: opts.paths.capture.dir,
      filename: "intro.mp4",
    });
  }
  if (outroCfg) {
    slatePaths.outro = await renderSlate({
      slate: outroCfg,
      viewport: opts.manifest.viewport,
      outDir: opts.paths.capture.dir,
      filename: "outro.mp4",
    });
  }

  const argv = buildFfmpegArgs({
    ...opts,
    slatePaths,
    slateConfigs: {
      intro: introCfg ? { durationMs: introCfg.durationMs } : undefined,
      outro: outroCfg ? { durationMs: outroCfg.durationMs } : undefined,
    },
  });
  await execa("ffmpeg", argv);
  return opts.paths.output;
}
