import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { initialState, reduce, saveState, loadState } from "../../src/core/store.js";
import type { Scene } from "../../src/types.js";

describe("state persistence", () => {
  it("saves and loads capture metadata", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-state-"));
    const file = path.join(tmp, "state.json");
    const scenes: Scene[] = [{ sourceLine: 5, title: "S1", prose: "", overlays: [], steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }] }];
    let s = initialState({
      demoFile: "/p/demo.demo",
      scenes,
    });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm" });
    await saveState(file, s);

    const reloadScenes: Scene[] = s.scenes.map((r) => ({
      sourceLine: r.sourceLine,
      title: r.title,
      prose: r.prose,
      overlays: r.overlays,
      steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }],
    }));
    const loaded = await loadState(file, reloadScenes, "/p/demo.demo");
    expect(loaded.scenes[0].state).toBe("captured");
    expect(loaded.scenes[0].webmPath).toBe("/cap/scene-001.webm");
  });

  it("loadState falls back to initial when file missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-state-"));
    const file = path.join(tmp, "missing.json");
    const loaded = await loadState(
      file,
      [{ sourceLine: 1, title: "S", prose: "", overlays: [], steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }] }],
      "/p/demo.demo",
    );
    expect(loaded.scenes[0].state).toBe("pending");
  });
});
