import { describe, it, expect } from "vitest";
import { initialState, reduce } from "../../src/core/store.js";

const scenes = [
  { sourceLine: 5, title: "S1", prose: "p1", overlays: [] },
  { sourceLine: 9, title: "S2", prose: "p2", overlays: [] },
] as any;

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
