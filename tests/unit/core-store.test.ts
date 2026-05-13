import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { initialState, reduce, saveState, loadState } from "../../src/core/store.js";
import type { Scene } from "../../src/types.js";

const scenes: Scene[] = [
  { sourceLine: 5, title: "S1", prose: "p1", overlays: [], steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }] },
  { sourceLine: 9, title: "S2", prose: "p2", overlays: [], steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }] },
];

describe("core store reducer", () => {
  it("starts every scene as pending", () => {
    const s = initialState({ demoFile: "/p/d.demo", scenes });
    expect(s.scenes.every((r) => r.state === "pending")).toBe(true);
    expect((s as any).allApproved).toBeUndefined();
  });

  it("capture-done marks captured + stores webm path", () => {
    let s = initialState({ demoFile: "/p/d.demo", scenes });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm", eventsPath: "/cap/scene-001.events.json" });
    expect(s.scenes[0].state).toBe("captured");
    expect(s.scenes[0].webmPath).toBe("/cap/scene-001.webm");
  });

  it("scene-changed drops captured back to pending", () => {
    let s = initialState({ demoFile: "/p/d.demo", scenes });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/x.webm" });
    s = reduce(s, { type: "scene-changed", sceneIndex: 0 });
    expect(s.scenes[0].state).toBe("pending");
    expect(s.scenes[0].webmPath).toBeUndefined();
  });

  it("rejects approve action (removed)", () => {
    let s = initialState({ demoFile: "/p/d.demo", scenes });
    expect(() => reduce(s, { type: "approve" } as any)).toThrow(/unknown action/i);
  });
});

describe("core store persistence", () => {
  it("coerces legacy state: 'approved' to 'captured' on load", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-store-"));
    const file = path.join(dir, "state.json");
    await fs.writeFile(file, JSON.stringify({
      version: 1,
      scenes: [
        { sourceLine: 5, state: "approved", webmPath: "/cap/scene-001.webm" },
        { sourceLine: 9, state: "captured", webmPath: "/cap/scene-002.webm" },
      ],
    }));
    const s = await loadState(file, scenes, "/p/d.demo");
    expect(s.scenes[0].state).toBe("captured");
    expect(s.scenes[1].state).toBe("captured");
  });

  it("round-trips current state with version 2", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-store-"));
    const file = path.join(dir, "state.json");
    let s = initialState({ demoFile: "/p/d.demo", scenes });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/x.webm" });
    await saveState(file, s);
    const loaded = await loadState(file, scenes, "/p/d.demo");
    expect(loaded.scenes[0].state).toBe("captured");
    expect(loaded.scenes[0].webmPath).toBe("/x.webm");
  });
});

describe("core/store — SceneRow.steps", () => {
  it("hydrates steps from Scene", () => {
    const scenes: Scene[] = [{
      sourceLine: 1,
      title: "T",
      prose: "",
      overlays: [],
      steps: [
        { says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] },
        { description: "Step A", descriptionSpan: { start: 0, end: 10, line: 4 }, says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] },
      ],
    }];
    const s = initialState({ demoFile: "x.demo", scenes });
    expect(s.scenes[0].steps).toHaveLength(2);
    expect(s.scenes[0].steps[1].description).toBe("Step A");
  });
});
