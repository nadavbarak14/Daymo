// tests/integration/controller.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { startFixtureServer } from "./server.js";
import { Controller } from "../../src/controller.js";

describe("Controller", () => {
  let serverUrl: string;
  let close: () => Promise<void>;
  let artifactsDir: string;
  beforeAll(async () => {
    const s = await startFixtureServer();
    serverUrl = s.url;
    close = s.close;
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-test-"));
  });
  afterEach(async () => {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  });

  it("captures page.webm and emits scene_start/scene_end events", async () => {
    const ctrl = await Controller.start({
      url: serverUrl,
      viewport: { width: 800, height: 600 },
      mocks: [{ source: "inline", routes: { "GET /api/me": { name: "Alex" }, "GET /api/projects": [] } }],
      artifactsDir,
    });
    try {
      await ctrl.runScene({
        sourceLine: 1,
        title: "Intro",
        prose: "hello",
        playwrightCode: { code: 'await page.waitForSelector("[data-testid=new-project-btn]");', sourceLine: 2 },
        overlays: [],
      });
    } finally {
      await ctrl.stop();
    }
    const events = JSON.parse(await fs.readFile(path.join(artifactsDir, "events.json"), "utf8"));
    const kinds = events.map((e: any) => e.kind);
    expect(kinds).toContain("scene_start");
    expect(kinds).toContain("scene_end");
    const stat = await fs.stat(path.join(artifactsDir, "page.webm"));
    expect(stat.size).toBeGreaterThan(0);
  });

  it("applies inline mocks so /api/me returns the configured body", async () => {
    const ctrl = await Controller.start({
      url: serverUrl,
      mocks: [{ source: "inline", routes: { "GET /api/me": { name: "Alex" }, "GET /api/projects": [] } }],
      artifactsDir,
    });
    try {
      const body = await ctrl.page.evaluate(async () => fetch("/api/me").then((r) => r.json()));
      expect(body).toEqual({ name: "Alex" });
    } finally {
      await ctrl.stop();
    }
  });

  it("renders the caption banner during a scene with prose", async () => {
    const ctrl = await Controller.start({
      url: serverUrl,
      mocks: [{ source: "inline", routes: { "GET /api/me": { name: "Alex" }, "GET /api/projects": [] } }],
      artifactsDir,
    });
    try {
      // Begin a scene with prose; check that the caption text is in the DOM mid-scene.
      const page = ctrl.page;
      const captionPromise = ctrl.runScene({
        sourceLine: 1,
        title: "Scene title",
        prose: "Scene narration text",
        playwrightCode: { code: 'await page.waitForTimeout(200);', sourceLine: 2 },
        overlays: [],
      });
      // Sample shortly into the scene.
      await page.waitForTimeout(50);
      const bodyText = await page.evaluate(() => document.body.textContent ?? "");
      expect(bodyText).toContain("Scene narration text");
      await captionPromise;
    } finally {
      await ctrl.stop();
    }
  });

  it("renders a declarative callout overlay during the scene", async () => {
    const ctrl = await Controller.start({
      url: serverUrl,
      mocks: [{ source: "inline", routes: { "GET /api/me": { name: "Alex" }, "GET /api/projects": [] } }],
      artifactsDir,
    });
    try {
      const page = ctrl.page;
      const scenePromise = ctrl.runScene({
        sourceLine: 1,
        title: "Scene with overlay",
        prose: "",
        playwrightCode: { code: 'await page.waitForTimeout(300);', sourceLine: 2 },
        overlays: [{ type: "callout", target: "h1", text: "Hello callout", duration: "2s" }],
      });
      // The overlay loop fires AFTER the playwrightCode block in runScene.
      // We need to sample after the playwright block has finished but before the scene ends.
      // Simpler: sample at the end of the scene after scenePromise resolves but before stop().
      await scenePromise;
      // Note: hideCaption fires at scene end, but the callout bubble has its own duration timer.
      // The bubble should still be in the DOM (its remove() is deferred to setTimeout duration+250ms).
      const bubbleCount = await page.evaluate(() =>
        Array.from(document.querySelectorAll("div"))
          .filter((d) => d.textContent === "Hello callout").length,
      );
      expect(bubbleCount).toBeGreaterThan(0);
    } finally {
      await ctrl.stop();
    }
  });

  it("emits an error event when a scene throws", async () => {
    const ctrl = await Controller.start({
      url: serverUrl,
      mocks: [{ source: "inline", routes: { "GET /api/me": { name: "Alex" }, "GET /api/projects": [] } }],
      artifactsDir,
    });
    await expect(
      ctrl.runScene({
        sourceLine: 1,
        title: "Bad scene",
        prose: "",
        playwrightCode: { code: 'throw new Error("intentional failure");', sourceLine: 2 },
        overlays: [],
      }),
    ).rejects.toThrow(/intentional failure/);
    await ctrl.stop();
    const events = JSON.parse(await fs.readFile(path.join(artifactsDir, "events.json"), "utf8"));
    const errorEvent = events.find((e: any) => e.kind === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.message).toMatch(/intentional failure/);
    expect(errorEvent.sceneIndex).toBe(1);
  });

  it("stamps sceneIndex on fast_forward and skip markers", async () => {
    const ctrl = await Controller.start({
      url: serverUrl,
      mocks: [{ source: "inline", routes: { "GET /api/me": { name: "Alex" }, "GET /api/projects": [] } }],
      artifactsDir,
    });
    const SCENE_LINE = 42;
    try {
      await ctrl.runScene({
        sourceLine: SCENE_LINE,
        title: "fx markers",
        prose: "",
        playwrightCode: {
          code: `
          await fx.fastForward(async () => { await page.waitForTimeout(50); }, 4);
          await fx.skip(async () => { await page.waitForTimeout(50); });
        `,
          sourceLine: 50,
        },
        overlays: [],
      });
    } finally {
      await ctrl.stop();
    }
    const events = JSON.parse(await fs.readFile(path.join(artifactsDir, "events.json"), "utf8"));
    const ff_start = events.find((e: any) => e.kind === "fast_forward_start");
    const ff_end   = events.find((e: any) => e.kind === "fast_forward_end");
    const sk_start = events.find((e: any) => e.kind === "skip_start");
    const sk_end   = events.find((e: any) => e.kind === "skip_end");
    expect(ff_start).toBeDefined();
    expect(ff_start.sceneIndex).toBe(SCENE_LINE);
    expect(ff_end.sceneIndex).toBe(SCENE_LINE);
    expect(sk_start.sceneIndex).toBe(SCENE_LINE);
    expect(sk_end.sceneIndex).toBe(SCENE_LINE);
    expect(ff_start.factor).toBe(4);
  });
});
