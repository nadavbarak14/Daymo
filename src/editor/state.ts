import type { Scene } from "../types.js";
import type { EditorState, SceneRow, StateAction } from "./types.js";

export interface InitialStateOpts {
  demoFile: string;
  scenes: Scene[];
}

export function initialState(opts: InitialStateOpts): EditorState {
  return {
    demoFile: opts.demoFile,
    scenes: opts.scenes.map(toRow),
    allApproved: false,
  };
}

function toRow(s: Scene): SceneRow {
  return { sourceLine: s.sourceLine, title: s.title, prose: s.prose, overlays: s.overlays, state: "pending" };
}

function withRow(s: EditorState, i: number, patch: Partial<SceneRow>): EditorState {
  const scenes = s.scenes.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
  const allApproved = scenes.length > 0 && scenes.every((r) => r.state === "approved");
  return { ...s, scenes, allApproved };
}

export function reduce(s: EditorState, a: StateAction): EditorState {
  switch (a.type) {
    case "capture-start":
      return withRow(s, a.sceneIndex, { errorMessage: undefined });
    case "capture-done":
      return withRow(s, a.sceneIndex, {
        state: "captured",
        webmPath: a.webmPath,
        eventsPath: a.eventsPath,
        capturedAt: Date.now(),
        errorMessage: undefined,
      });
    case "capture-error":
      return withRow(s, a.sceneIndex, { errorMessage: a.message });
    case "approve": {
      const row = s.scenes[a.sceneIndex];
      if (!row) throw new Error(`scene ${a.sceneIndex} not found`);
      if (a.approved && row.state === "pending") throw new Error("not captured yet");
      return withRow(s, a.sceneIndex, { state: a.approved ? "approved" : "captured" });
    }
    case "scene-changed":
      return withRow(s, a.sceneIndex, { state: "pending", webmPath: undefined, eventsPath: undefined, capturedAt: undefined });
    case "scenes-replaced":
      return { ...s, scenes: a.scenes.map(toRow), allApproved: false };
    default:
      return s;
  }
}
