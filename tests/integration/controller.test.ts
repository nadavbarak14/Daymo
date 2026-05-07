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

  it("captures raw_page.webm and emits scene_start/scene_end events", async () => {
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
    const stat = await fs.stat(path.join(artifactsDir, "raw_page.webm"));
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
});
