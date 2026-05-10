// src/runner.ts
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { parse } from "./parser.js";
import { Controller } from "./controller.js";
import { compose } from "./compositor.js";
import { CachedTtsProvider } from "./tts/cache.js";
import { EdgeTtsProvider } from "./tts/edge.js";
import { MockTtsProvider } from "./tts/mock.js";
import type { ArtifactPaths } from "./types.js";

export interface RenderOpts {
  /** Absolute or cwd-relative path to a .demo file. */
  demoFile: string;
  /** Output directory base. Default: ./artifacts */
  artifactsBase?: string;
}

export async function render(opts: RenderOpts): Promise<{ mp4Path: string; artifactsDir: string }> {
  const source = await fs.readFile(opts.demoFile, "utf8");
  const ast = parse(source);
  const baseDir = path.dirname(path.resolve(opts.demoFile));

  const id = crypto.randomBytes(4).toString("hex");
  const artifactsDir = path.resolve(opts.artifactsBase ?? "./artifacts", id);
  await fs.mkdir(artifactsDir, { recursive: true });
  const artifacts: ArtifactPaths = {
    dir: artifactsDir,
    rawVideo: path.join(artifactsDir, "raw_page.webm"),
    events: path.join(artifactsDir, "events.json"),
    output: path.join(artifactsDir, "output.mp4"),
  };

  const ttsCacheDir = path.join(baseDir, ".daymo", "tts");
  const innerProvider = process.env.DAYMO_TTS_PROVIDER === "mock" ? new MockTtsProvider() : new EdgeTtsProvider();
  const ttsProvider = new CachedTtsProvider(innerProvider, ttsCacheDir);

  const ctrl = await Controller.start({
    url: ast.frontmatter.url,
    viewport: ast.frontmatter.viewport,
    mocks: ast.frontmatter.mocks,
    storageStatePath: ast.frontmatter.auth?.storageState
      ? path.resolve(baseDir, ast.frontmatter.auth.storageState)
      : undefined,
    artifactsDir,
    ttsProvider,
    ttsConfig: { voice: ast.frontmatter.tts.voice, rate: ast.frontmatter.tts.rate },
  });
  try {
    for (const scene of ast.scenes) {
      await ctrl.runScene(scene);
    }
  } finally {
    await ctrl.stop();
  }

  const musicSrc = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  await compose({ artifacts, musicSrc });
  return { mp4Path: artifacts.output, artifactsDir };
}
