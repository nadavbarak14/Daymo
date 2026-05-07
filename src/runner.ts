// src/runner.ts
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { parse } from "./parser.js";
import { Controller } from "./controller.js";
import { compose } from "./compositor.js";
import { buildManifest, writeManifest, readManifest } from "./manifest.js";
import type { ArtifactPaths, DemoAst, RunnerEvent } from "./types.js";

export interface CaptureOpts {
  /** Absolute or cwd-relative path to a .demo file. */
  demoFile: string;
  /** Output directory base. Default: ./artifacts */
  artifactsBase?: string;
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

export async function capture(opts: CaptureOpts): Promise<{ artifactsDir: string; ast: DemoAst }> {
  const source = await fs.readFile(opts.demoFile, "utf8");
  const ast = parse(source);
  const baseDir = path.dirname(path.resolve(opts.demoFile));

  const id = crypto.randomBytes(4).toString("hex");
  const artifactsDir = path.resolve(opts.artifactsBase ?? "./artifacts", id);
  const paths = buildArtifactPaths(artifactsDir);
  await fs.mkdir(paths.capture.dir, { recursive: true });

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

  const eventsRaw = await fs.readFile(paths.capture.events, "utf8");
  const events = JSON.parse(eventsRaw) as RunnerEvent[];
  const m = buildManifest({
    demoFile: path.resolve(opts.demoFile),
    captureMode: ast.frontmatter.captureMode ?? "continuous",
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
