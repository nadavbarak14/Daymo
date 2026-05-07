// src/runner.ts
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { parse } from "./parser.js";
import { Controller } from "./controller.js";
import { compose } from "./compositor.js";
import { buildManifest, writeManifest, readManifest, slugify } from "./manifest.js";
import type { ArtifactPaths, CaptureMode, DemoAst, RunnerEvent } from "./types.js";

export interface CaptureOpts {
  /** Absolute or cwd-relative path to a .demo file. */
  demoFile: string;
  /** Output directory base. Default: ./artifacts */
  artifactsBase?: string;
  /** 0-based scene index to re-shoot. Per-scene mode only. Requires bundleDir. */
  onlyScene?: number;
  /** Existing bundle to update (per-scene mode only). Required when onlyScene is set. */
  bundleDir?: string;
}

export interface ComposeFromBundleOpts {
  bundleDir: string;                // an artifacts/<id> dir
  demoFileOverride?: string;        // optional .demo path; defaults to manifest.demoFile
}

function buildArtifactPaths(rootDir: string): ArtifactPaths {
  const captureDir = path.join(rootDir, "capture");
  return {
    dir: rootDir,
    capture: {
      dir: captureDir,
      manifest: path.join(captureDir, "capture.json"),
      events: path.join(captureDir, "events.json"),
      rawVideo: path.join(captureDir, "page.webm"),
      scenesDir: path.join(captureDir, "scenes"),
    },
    output: path.join(rootDir, "output.mp4"),
    composeLog: path.join(rootDir, "compose.log"),
  };
}

async function captureContinuous(
  opts: CaptureOpts,
  ast: DemoAst,
  paths: ArtifactPaths,
): Promise<void> {
  const baseDir = path.dirname(path.resolve(opts.demoFile));
  const ctrl = await Controller.start({
    url: ast.frontmatter.url,
    viewport: ast.frontmatter.viewport,
    mocks: ast.frontmatter.mocks,
    storageStatePath: ast.frontmatter.auth?.storageState
      ? path.resolve(baseDir, ast.frontmatter.auth.storageState)
      : undefined,
    artifactsDir: paths.capture.dir,
  });
  try {
    for (const scene of ast.scenes) await ctrl.runScene(scene);
  } finally {
    await ctrl.stop();
  }
}

async function capturePerScene(
  opts: CaptureOpts,
  ast: DemoAst,
  paths: ArtifactPaths,
): Promise<void> {
  const baseDir = path.dirname(path.resolve(opts.demoFile));
  await fs.mkdir(paths.capture.scenesDir, { recursive: true });
  const allEvents: RunnerEvent[] = [];
  let timeOffsetMs = 0;

  for (let i = 0; i < ast.scenes.length; i++) {
    const scene = ast.scenes[i];
    const sceneDir = path.join(
      paths.capture.scenesDir,
      `${String(i).padStart(2, "0")}-${slugify(scene.title)}`,
    );
    await fs.mkdir(sceneDir, { recursive: true });

    const overrides = scene.sceneConfig ?? {};
    const ctrl = await Controller.start({
      url: overrides.url ?? ast.frontmatter.url,
      viewport: ast.frontmatter.viewport,
      mocks: overrides.mocks ?? ast.frontmatter.mocks,
      storageStatePath: overrides.auth?.storageState
        ? path.resolve(baseDir, overrides.auth.storageState)
        : ast.frontmatter.auth?.storageState
          ? path.resolve(baseDir, ast.frontmatter.auth.storageState)
          : undefined,
      artifactsDir: sceneDir,
    });
    try {
      await ctrl.runScene(scene);
    } finally {
      await ctrl.stop();
    }

    // Read the scene's events.json (controller wrote it on stop).
    const sceneEvents: RunnerEvent[] = JSON.parse(
      await fs.readFile(path.join(sceneDir, "events.json"), "utf8"),
    );

    // Time-shift each event's t by timeOffsetMs so the unified timeline is contiguous.
    for (const ev of sceneEvents) (ev as any).t = (ev as any).t + timeOffsetMs;
    allEvents.push(...sceneEvents);

    // Advance the offset to the end of this scene.
    const sceneEnd = sceneEvents.find((e) => e.kind === "scene_end");
    timeOffsetMs = sceneEnd ? (sceneEnd as any).t : timeOffsetMs;
  }

  // Write the unified events log at the bundle root.
  await fs.writeFile(paths.capture.events, JSON.stringify(allEvents, null, 2));
}

async function captureSingleSceneIntoBundle(
  opts: CaptureOpts,
  ast: DemoAst,
  paths: ArtifactPaths,
): Promise<void> {
  const sceneIndex = opts.onlyScene!;
  if (sceneIndex < 0 || sceneIndex >= ast.scenes.length) {
    throw new Error(`--scene ${sceneIndex} out of range (demo has ${ast.scenes.length} scenes)`);
  }
  const baseDir = path.dirname(path.resolve(opts.demoFile));
  const scene = ast.scenes[sceneIndex];
  const sceneDir = path.join(
    paths.capture.scenesDir,
    `${String(sceneIndex).padStart(2, "0")}-${slugify(scene.title)}`,
  );
  // Wipe any existing artifacts in this scene's dir.
  await fs.rm(sceneDir, { recursive: true, force: true });
  await fs.mkdir(sceneDir, { recursive: true });

  const overrides = scene.sceneConfig ?? {};
  const ctrl = await Controller.start({
    url: overrides.url ?? ast.frontmatter.url,
    viewport: ast.frontmatter.viewport,
    mocks: overrides.mocks ?? ast.frontmatter.mocks,
    storageStatePath: overrides.auth?.storageState
      ? path.resolve(baseDir, overrides.auth.storageState)
      : ast.frontmatter.auth?.storageState
        ? path.resolve(baseDir, ast.frontmatter.auth.storageState)
        : undefined,
    artifactsDir: sceneDir,
  });
  try {
    await ctrl.runScene(scene);
  } finally {
    await ctrl.stop();
  }
}

async function rebuildUnifiedEventsLog(
  ast: DemoAst,
  paths: ArtifactPaths,
): Promise<void> {
  const allEvents: RunnerEvent[] = [];
  let timeOffsetMs = 0;
  for (let i = 0; i < ast.scenes.length; i++) {
    const scene = ast.scenes[i];
    const sceneDir = path.join(
      paths.capture.scenesDir,
      `${String(i).padStart(2, "0")}-${slugify(scene.title)}`,
    );
    const eventsPath = path.join(sceneDir, "events.json");
    let sceneEvents: RunnerEvent[];
    try {
      sceneEvents = JSON.parse(await fs.readFile(eventsPath, "utf8"));
    } catch (e) {
      throw new Error(
        `--scene re-shoot: scene ${i} has no events.json at ${eventsPath} (was the bundle captured in per-scene mode?): ${(e as Error).message}`,
      );
    }
    const sceneEventsCopy = sceneEvents.map((ev) => ({ ...ev, t: (ev as any).t + timeOffsetMs }));
    allEvents.push(...sceneEventsCopy as RunnerEvent[]);
    const sceneEnd = sceneEventsCopy.find((e) => e.kind === "scene_end");
    timeOffsetMs = sceneEnd ? (sceneEnd as any).t : timeOffsetMs;
  }
  await fs.writeFile(paths.capture.events, JSON.stringify(allEvents, null, 2));
}

export async function capture(opts: CaptureOpts): Promise<{ artifactsDir: string; ast: DemoAst }> {
  const source = await fs.readFile(opts.demoFile, "utf8");
  const ast = parse(source);

  const captureMode: CaptureMode = ast.frontmatter.captureMode ?? "continuous";

  // Re-shoot path
  if (opts.onlyScene !== undefined) {
    if (captureMode !== "per-scene") {
      throw new Error(`--scene re-shoot requires captureMode: per-scene in the .demo file`);
    }
    if (!opts.bundleDir) {
      throw new Error(`--scene re-shoot requires --bundle <dir> pointing to an existing bundle`);
    }
    const artifactsDir = path.resolve(opts.bundleDir);
    const paths = buildArtifactPaths(artifactsDir);
    await fs.mkdir(paths.capture.scenesDir, { recursive: true });
    await captureSingleSceneIntoBundle(opts, ast, paths);
    await rebuildUnifiedEventsLog(ast, paths);
    // Rebuild manifest
    const events = JSON.parse(await fs.readFile(paths.capture.events, "utf8")) as RunnerEvent[];
    const m = buildManifest({
      demoFile: path.resolve(opts.demoFile),
      captureMode,
      viewport: ast.frontmatter.viewport ?? { width: 1440, height: 900 },
      scenes: ast.scenes,
      events,
    });
    await writeManifest(paths.capture.dir, m);
    return { artifactsDir, ast };
  }

  // Standard fresh capture path (existing logic)
  const id = crypto.randomBytes(4).toString("hex");
  const artifactsDir = path.resolve(opts.artifactsBase ?? "./artifacts", id);
  const paths = buildArtifactPaths(artifactsDir);
  await fs.mkdir(paths.capture.dir, { recursive: true });

  if (captureMode === "per-scene") {
    await capturePerScene(opts, ast, paths);
  } else {
    await captureContinuous(opts, ast, paths);
  }

  // Build the manifest from the (unified) events log.
  const eventsRaw = await fs.readFile(paths.capture.events, "utf8");
  const events = JSON.parse(eventsRaw) as RunnerEvent[];
  const m = buildManifest({
    demoFile: path.resolve(opts.demoFile),
    captureMode,
    viewport: ast.frontmatter.viewport ?? { width: 1440, height: 900 },
    scenes: ast.scenes,
    events,
  });
  await writeManifest(paths.capture.dir, m);
  return { artifactsDir, ast };
}

export async function composeFromBundle(opts: ComposeFromBundleOpts): Promise<{ mp4Path: string }> {
  const paths = buildArtifactPaths(opts.bundleDir);
  const m = await readManifest(paths.capture.dir);
  const demoFile = opts.demoFileOverride ?? m.demoFile;
  const source = await fs.readFile(demoFile, "utf8");
  const ast = parse(source);
  const baseDir = path.dirname(demoFile);
  const musicSrc = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  await compose({ paths, manifest: m, ast, baseDir, musicSrc });
  return { mp4Path: paths.output };
}

export interface RenderOpts extends CaptureOpts {}

export async function render(opts: RenderOpts): Promise<{ mp4Path: string; artifactsDir: string }> {
  const { artifactsDir } = await capture(opts);
  const { mp4Path } = await composeFromBundle({ bundleDir: artifactsDir });
  return { mp4Path, artifactsDir };
}
