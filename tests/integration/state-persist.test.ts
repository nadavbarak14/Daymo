import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { initialState, reduce, saveState, loadState } from "../../src/editor/state.js";

describe("state persistence", () => {
  it("saves and loads approval flags + capture metadata", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-state-"));
    const file = path.join(tmp, "state.json");
    let s = initialState({
      demoFile: "/p/demo.demo",
      scenes: [{ sourceLine: 5, title: "S1", prose: "", overlays: [] }] as any,
    });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm" });
    s = reduce(s, { type: "approve", sceneIndex: 0, approved: true });
    await saveState(file, s);

    const loaded = await loadState(file, s.scenes.map((r) => ({ sourceLine: r.sourceLine, title: r.title, prose: r.prose, overlays: r.overlays })) as any, "/p/demo.demo");
    expect(loaded.scenes[0].state).toBe("approved");
    expect(loaded.scenes[0].webmPath).toBe("/cap/scene-001.webm");
    expect(loaded.allApproved).toBe(true);
  });

  it("loadState falls back to initial when file missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-state-"));
    const file = path.join(tmp, "missing.json");
    const loaded = await loadState(file, [{ sourceLine: 1, title: "S", prose: "", overlays: [] }] as any, "/p/demo.demo");
    expect(loaded.scenes[0].state).toBe("pending");
  });
});
