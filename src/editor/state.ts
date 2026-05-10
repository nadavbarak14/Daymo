import type { Scene } from "../types.js";
import type { EditorState, SceneRow, StateAction } from "./types.js";
import fs from "node:fs/promises";
import path from "node:path";

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

interface Persisted {
  version: 1;
  scenes: Array<{
    sourceLine: number;
    state: import("./types.js").SceneState;
    webmPath?: string;
    eventsPath?: string;
    capturedAt?: number;
  }>;
}

export async function saveState(file: string, s: EditorState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data: Persisted = {
    version: 1,
    scenes: s.scenes.map((r) => ({
      sourceLine: r.sourceLine,
      state: r.state,
      webmPath: r.webmPath,
      eventsPath: r.eventsPath,
      capturedAt: r.capturedAt,
    })),
  };
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

export async function loadState(file: string, scenes: Scene[], demoFile: string): Promise<EditorState> {
  let raw: string;
  try { raw = await fs.readFile(file, "utf8"); }
  catch { return initialState({ demoFile, scenes }); }
  const data = JSON.parse(raw) as Persisted;
  let s = initialState({ demoFile, scenes });
  for (let i = 0; i < s.scenes.length; i++) {
    const persisted = data.scenes.find((p) => p.sourceLine === s.scenes[i].sourceLine);
    if (!persisted) continue;
    if (persisted.state === "captured" || persisted.state === "approved") {
      if (persisted.webmPath) {
        s = reduce(s, { type: "capture-done", sceneIndex: i, webmPath: persisted.webmPath, eventsPath: persisted.eventsPath });
      }
    }
    if (persisted.state === "approved") {
      s = reduce(s, { type: "approve", sceneIndex: i, approved: true });
    }
  }
  return s;
}
