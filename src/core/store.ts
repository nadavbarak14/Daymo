// src/core/store.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { Scene, Step } from "../types.js";

export type SceneState = "pending" | "captured";

export interface SceneRow {
  sourceLine: number;
  title: string;
  prose: string;
  overlays: Scene["overlays"];
  steps: Step[];
  /** ms-from-scene-start for each parsed step. Parallel to steps[].
   *  Populated from events.json after capture; undefined when not yet captured. */
  stepTimes?: number[];
  state: SceneState;
  webmPath?: string;
  eventsPath?: string;
  capturedAt?: number;
  errorMessage?: string;
}

export interface EditorState {
  demoFile: string;
  scenes: SceneRow[];
}

export type StateAction =
  | { type: "capture-start"; sceneIndex: number }
  | { type: "capture-done"; sceneIndex: number; webmPath: string; eventsPath?: string }
  | { type: "capture-error"; sceneIndex: number; message: string }
  | { type: "step-times"; sceneIndex: number; stepTimes: number[] }
  | { type: "scene-changed"; sceneIndex: number }
  | { type: "scenes-replaced"; scenes: Scene[] };

export function initialState(opts: { demoFile: string; scenes: Scene[] }): EditorState {
  return {
    demoFile: opts.demoFile,
    scenes: opts.scenes.map(toRow),
  };
}

function toRow(s: Scene): SceneRow {
  return {
    sourceLine: s.sourceLine,
    title: s.title,
    prose: s.prose,
    overlays: s.overlays,
    steps: s.steps,
    state: "pending",
  };
}

function withRow(s: EditorState, i: number, patch: Partial<SceneRow>): EditorState {
  const scenes = s.scenes.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
  return { ...s, scenes };
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
    case "step-times":
      return withRow(s, a.sceneIndex, { stepTimes: a.stepTimes });
    case "scene-changed":
      return withRow(s, a.sceneIndex, {
        state: "pending",
        webmPath: undefined,
        eventsPath: undefined,
        capturedAt: undefined,
        stepTimes: undefined,
      });
    case "scenes-replaced":
      return { ...s, scenes: a.scenes.map(toRow) };
    default:
      throw new Error(`unknown action: ${(a as any).type}`);
  }
}

interface Persisted {
  version: 1 | 2;
  scenes: Array<{
    sourceLine: number;
    state: SceneState | "approved"; // "approved" tolerated for backcompat
    webmPath?: string;
    eventsPath?: string;
    capturedAt?: number;
  }>;
}

export async function saveState(file: string, s: EditorState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data: Persisted = {
    version: 2,
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
    // Coerce legacy "approved" → "captured"
    const isCaptured = persisted.state === "captured" || persisted.state === "approved";
    if (isCaptured && persisted.webmPath) {
      s = reduce(s, {
        type: "capture-done",
        sceneIndex: i,
        webmPath: persisted.webmPath,
        eventsPath: persisted.eventsPath,
      });
    }
  }
  return s;
}
