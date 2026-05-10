import { describe, it, expect } from "vitest";
import { initialState, reduce } from "../../src/editor/state.js";

describe("state reducer", () => {
  const base = initialState({
    demoFile: "/p/demo.demo",
    scenes: [
      { sourceLine: 5, title: "S1", prose: "p1", overlays: [] },
      { sourceLine: 9, title: "S2", prose: "p2", overlays: [] },
    ] as any,
  });

  it("captureDone marks captured + stores webm path", () => {
    const s = reduce(base, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm" });
    expect(s.scenes[0].state).toBe("captured");
    expect(s.scenes[0].webmPath).toBe("/cap/scene-001.webm");
  });

  it("approve only allowed when captured", () => {
    expect(() => reduce(base, { type: "approve", sceneIndex: 0, approved: true })).toThrow(/not captured/);
    const s2 = reduce(base, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm" });
    const s3 = reduce(s2, { type: "approve", sceneIndex: 0, approved: true });
    expect(s3.scenes[0].state).toBe("approved");
  });

  it("demo edit drops a captured scene back to pending", () => {
    let s = reduce(base, { type: "capture-done", sceneIndex: 0, webmPath: "/x.webm" });
    s = reduce(s, { type: "approve", sceneIndex: 0, approved: true });
    s = reduce(s, { type: "scene-changed", sceneIndex: 0 });
    expect(s.scenes[0].state).toBe("pending");
    expect(s.scenes[0].webmPath).toBeUndefined();
  });

  it("allApproved is true only when all scenes approved", () => {
    let s = base;
    expect(s.allApproved).toBe(false);
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/a.webm" });
    s = reduce(s, { type: "approve", sceneIndex: 0, approved: true });
    s = reduce(s, { type: "capture-done", sceneIndex: 1, webmPath: "/b.webm" });
    s = reduce(s, { type: "approve", sceneIndex: 1, approved: true });
    expect(s.allApproved).toBe(true);
  });
});
