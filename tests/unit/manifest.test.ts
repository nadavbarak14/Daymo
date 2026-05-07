// tests/unit/manifest.test.ts
import { describe, it, expect } from "vitest";
import { buildManifest, slugify } from "../../src/manifest.js";
import type { RunnerEvent, Scene } from "../../src/types.js";

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric runs with single dashes", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("  Open the dialog  ")).toBe("open-the-dialog");
    expect(slugify("UPPER_case 123")).toBe("upper-case-123");
  });
  it("strips leading and trailing dashes", () => {
    expect(slugify("-foo-")).toBe("foo");
    expect(slugify("!!!hi")).toBe("hi");
  });
});

describe("buildManifest", () => {
  it("derives scene boundaries from scene_start/scene_end events (continuous mode)", () => {
    const scenes: Scene[] = [
      { sourceLine: 5,  title: "Welcome",     prose: "", overlays: [] },
      { sourceLine: 12, title: "Open dialog", prose: "", overlays: [] },
    ];
    const events: RunnerEvent[] = [
      { kind: "scene_start", t: 0,     index: 5,  title: "Welcome",     prose: "" },
      { kind: "scene_end",   t: 8300,  index: 5 },
      { kind: "scene_start", t: 8300,  index: 12, title: "Open dialog", prose: "" },
      { kind: "scene_end",   t: 14700, index: 12 },
    ];
    const m = buildManifest({
      demoFile: "/abs/demo.demo",
      captureMode: "continuous",
      viewport: { width: 1440, height: 900 },
      scenes, events,
    });
    expect(m.version).toBe(2);
    expect(m.scenes).toHaveLength(2);
    expect(m.scenes[0]).toMatchObject({
      index: 0, title: "Welcome", slug: "welcome",
      sourceLine: 5, tStartMs: 0, tEndMs: 8300,
    });
    expect(m.scenes[1]).toMatchObject({
      index: 1, title: "Open dialog", slug: "open-dialog",
      sourceLine: 12, tStartMs: 8300, tEndMs: 14700,
    });
  });

  it("derives markers from fast_forward/skip events", () => {
    const events: RunnerEvent[] = [
      { kind: "scene_start", t: 0, index: 5, title: "x", prose: "" },
      { kind: "fast_forward_start", t: 1000, sceneIndex: 5, factor: 4 },
      { kind: "fast_forward_end",   t: 5000, sceneIndex: 5 },
      { kind: "skip_start",         t: 6000, sceneIndex: 5 },
      { kind: "skip_end",           t: 7000, sceneIndex: 5 },
      { kind: "scene_end",          t: 8000, index: 5 },
    ];
    const m = buildManifest({
      demoFile: "/abs/demo.demo",
      captureMode: "continuous",
      viewport: { width: 1440, height: 900 },
      scenes: [{ sourceLine: 5, title: "x", prose: "", overlays: [] }],
      events,
    });
    expect(m.markers).toEqual([
      { kind: "fast_forward", sceneIndex: 0, tStartMs: 1000, tEndMs: 5000, factor: 4 },
      { kind: "skip",         sceneIndex: 0, tStartMs: 6000, tEndMs: 7000 },
    ]);
  });

  it("includes captureMode and viewport in the manifest", () => {
    const m = buildManifest({
      demoFile: "/x", captureMode: "per-scene",
      viewport: { width: 1280, height: 720 },
      scenes: [{ sourceLine: 1, title: "x", prose: "", overlays: [] }],
      events: [
        { kind: "scene_start", t: 0, index: 1, title: "x", prose: "" },
        { kind: "scene_end",   t: 1000, index: 1 },
      ],
    });
    expect(m.captureMode).toBe("per-scene");
    expect(m.viewport).toEqual({ width: 1280, height: 720 });
    expect(m.demoFile).toBe("/x");
    expect(typeof m.createdAt).toBe("string");
  });

  it("zeroes tEndMs/tStartMs for scenes that never received scene_start/end events", () => {
    const m = buildManifest({
      demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 },
      scenes: [{ sourceLine: 1, title: "x", prose: "", overlays: [] }],
      events: [],
    });
    expect(m.scenes[0].tStartMs).toBe(0);
    expect(m.scenes[0].tEndMs).toBe(0);
  });
});
