// tests/e2e/smoke.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { startFixtureServer } from "../integration/server.js";
import { render } from "../../src/runner.js";

async function probeStreams(mp4: string): Promise<{ codec_type: string; duration?: string }[]> {
  const probe = await execa("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,duration",
    "-of", "json",
    mp4,
  ]);
  return (JSON.parse(probe.stdout) as { streams: { codec_type: string; duration?: string }[] }).streams;
}

describe("E2E smoke", () => {
  let serverUrl: string;
  let close: () => Promise<void>;
  let workDir: string;

  beforeAll(async () => {
    const s = await startFixtureServer();
    serverUrl = s.url;
    close = s.close;
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-smoke-"));
  });
  afterAll(async () => {
    await close();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  async function materializeDemo(name: string, withMusic: boolean): Promise<string> {
    const tpl = await fs.readFile(
      path.resolve("tests/fixtures/demos/two-scene.demo"), "utf8",
    );
    const demoPath = path.join(workDir, name);
    const musicLine = withMusic
      ? `music: ${path.resolve("tests/fixtures/audio/music.mp3")}`
      : "";
    await fs.writeFile(
      demoPath,
      tpl
        .replace("__WILL_BE_REPLACED__", serverUrl)
        .replace("__MUSIC_LINE__", musicLine),
    );
    return demoPath;
  }

  it("with music: produces an mp4 with video and audio streams", async () => {
    const demoPath = await materializeDemo("with-music.demo", true);
    const { mp4Path } = await render({ demoFile: demoPath, artifactsBase: workDir });
    const stat = await fs.stat(mp4Path);
    expect(stat.size).toBeGreaterThan(1000);
    const streams = await probeStreams(mp4Path);
    const types = streams.map((s) => s.codec_type).sort();
    expect(types).toEqual(["audio", "video"]);
    const videoDuration = Number(streams.find((s) => s.codec_type === "video")?.duration ?? 0);
    expect(videoDuration).toBeGreaterThan(0);
    // events.json should contain a step event for the second scene
    const artifactsDir = path.dirname(mp4Path);
    const events: any[] = JSON.parse(
      await fs.readFile(path.join(artifactsDir, "events.json"), "utf8"),
    );
    const step = events.find((e) => e.kind === "step");
    expect(step).toBeDefined();
    expect(step.description).toBe("Open the dialog");
    expect(step.stepIndex).toBe(1);
    expect(step.sceneIndex).toBe(1); // second scene, 0-indexed
  }, 60_000);

  it("without music: produces an mp4 with a video stream and no audio stream", async () => {
    const demoPath = await materializeDemo("no-music.demo", false);
    const { mp4Path } = await render({ demoFile: demoPath, artifactsBase: workDir });
    const streams = await probeStreams(mp4Path);
    const types = streams.map((s) => s.codec_type);
    expect(types).toEqual(["video"]);
  }, 60_000);
});
