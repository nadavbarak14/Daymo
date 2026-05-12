import path from "node:path";
import fs from "node:fs/promises";
import { Controller } from "../controller.js";
import { CachedTtsProvider } from "../tts/cache.js";
import { EdgeTtsProvider } from "../tts/edge.js";
import { MockTtsProvider } from "../tts/mock.js";
import type { DemoAst } from "../types.js";

export interface CaptureSingleSceneOpts {
  /** Directory to write `scene-<NNN>.webm` and `scene-<NNN>.events.json` into. */
  capturesDir: string;
  /** Path to the source `.demo`, used as the basedir for storageState/music. */
  demoFile: string;
}

export interface CaptureSingleSceneResult {
  webm: string;
  events: string;
}

export async function captureSingleScene(
  ast: DemoAst,
  sceneIndex: number,
  opts: CaptureSingleSceneOpts,
): Promise<CaptureSingleSceneResult> {
  if (sceneIndex < 0 || sceneIndex >= ast.scenes.length) {
    throw new Error(`scene index ${sceneIndex} out of range`);
  }
  const scene = ast.scenes[sceneIndex];
  await fs.mkdir(opts.capturesDir, { recursive: true });

  const baseDir = path.dirname(path.resolve(opts.demoFile));
  const tmpArtifacts = await fs.mkdtemp(path.join(opts.capturesDir, `.tmp-${sceneIndex}-`));

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
    artifactsDir: tmpArtifacts,
    ttsProvider,
    ttsConfig: { voice: ast.frontmatter.tts.voice, rate: ast.frontmatter.tts.rate },
  });
  try {
    await ctrl.runScene(scene, sceneIndex);
  } finally {
    await ctrl.stop();
  }

  const tmpWebm = path.join(tmpArtifacts, "raw_page.webm");
  const tmpEvents = path.join(tmpArtifacts, "events.json");
  const tag = String(sceneIndex + 1).padStart(3, "0");
  const finalWebm = path.join(opts.capturesDir, `scene-${tag}.webm`);
  const finalEvents = path.join(opts.capturesDir, `scene-${tag}.events.json`);

  await fs.rename(tmpWebm, finalWebm);
  await fs.rename(tmpEvents, finalEvents);
  await fs.rm(tmpArtifacts, { recursive: true, force: true });

  return { webm: finalWebm, events: finalEvents };
}
