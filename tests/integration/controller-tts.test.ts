import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { Controller } from "../../src/controller.js";
import { MockTtsProvider } from "../../src/tts/mock.js";
import { CachedTtsProvider } from "../../src/tts/cache.js";
import { startFixtureServer } from "./server.js";

describe("controller + TTS", () => {
  it("pre-synthesizes fx.say literals and records say events with offsets", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-ctrl-tts-"));
    const provider = new CachedTtsProvider(new MockTtsProvider(), path.join(dir, "tts"));
    const ctrl = await Controller.start({
      url: "about:blank",
      viewport: { width: 200, height: 200 },
      artifactsDir: dir,
      ttsProvider: provider,
      ttsConfig: { voice: "en-US-AriaNeural", rate: "+0%" },
    });
    try {
      await ctrl.runScene({
        sourceLine: 1,
        title: "S",
        prose: "",
        playwrightCode: { code: `await fx.say("hello world");\nawait fx.pause(0.1);`, sourceLine: 1 },
        overlays: [],
        steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }],
      }, 0);
    } finally {
      await ctrl.stop();
    }
    const events = JSON.parse(await fs.readFile(path.join(dir, "events.json"), "utf8"));
    const sayEvent = events.find((e: any) => e.kind === "say");
    expect(sayEvent).toBeDefined();
    expect(sayEvent.text).toBe("hello world");
    expect(sayEvent.durationMs).toBe(1000); // mock: 500ms × 2 words
  }, 30_000);

  it("records a say-event hash that matches the cached audio filename when cacheVersion > 1", async () => {
    // Regression: EdgeTtsProvider has cacheVersion=2, so CachedTtsProvider
    // writes "<computeKey(...,cacheVersion:2)>.mp3", but the controller used to
    // compute the event hash without the provider's cacheVersion (defaulting to
    // 1). The two diverged, so `daymo stitch` (which reads `${ev.hash}.mp3`)
    // could not find the audio. Reproduce with a cacheVersion=2 mock provider.
    class MockV2 extends MockTtsProvider {
      readonly id = "mockv2";
      readonly cacheVersion = 2;
    }
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-ctrl-tts-cv-"));
    const ttsDir = path.join(dir, "tts");
    const provider = new CachedTtsProvider(new MockV2(), ttsDir);
    const ctrl = await Controller.start({
      url: "about:blank",
      viewport: { width: 200, height: 200 },
      artifactsDir: dir,
      ttsProvider: provider,
      ttsConfig: { voice: "en-US-AriaNeural", rate: "+0%" },
    });
    try {
      await ctrl.runScene({
        sourceLine: 1,
        title: "S",
        prose: "",
        playwrightCode: { code: `await fx.say("hello world");\nawait fx.pause(0.1);`, sourceLine: 1 },
        overlays: [],
        steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }],
      }, 0);
    } finally {
      await ctrl.stop();
    }
    const events = JSON.parse(await fs.readFile(path.join(dir, "events.json"), "utf8"));
    const sayEvent = events.find((e: any) => e.kind === "say");
    expect(sayEvent).toBeDefined();
    // stitch reads `${ev.hash}.mp3` — that exact file must exist on disk.
    await expect(fs.access(path.join(ttsDir, `${sayEvent.hash}.mp3`))).resolves.toBeUndefined();
  }, 30_000);

  it("sayTable survives mid-scene page navigations", async () => {
    const { url, close } = await startFixtureServer();
    try {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-ctrl-tts-nav-"));
      const provider = new CachedTtsProvider(new MockTtsProvider(), path.join(dir, "tts"));
      const ctrl = await Controller.start({
        url,
        viewport: { width: 200, height: 200 },
        artifactsDir: dir,
        ttsProvider: provider,
        ttsConfig: { voice: "en-US-AriaNeural", rate: "+0%" },
      });
      try {
        await ctrl.runScene({
          sourceLine: 1,
          title: "S",
          prose: "",
          playwrightCode: {
            code: [
              'await fx.say("before navigation");',
              'await page.goto("/");',
              'await fx.say("after navigation");',
            ].join("\n"),
            sourceLine: 1,
          },
          overlays: [],
          steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }],
        }, 0);
      } finally {
        await ctrl.stop();
      }
      const events = JSON.parse(await fs.readFile(path.join(dir, "events.json"), "utf8"));
      const says = events.filter((e: any) => e.kind === "say").map((e: any) => e.text);
      expect(says).toEqual(["before navigation", "after navigation"]);
      const errors = events.filter((e: any) => e.kind === "error");
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  }, 30_000);
});
