import type { Scene } from "../types.js";

export type SceneState = "pending" | "captured" | "approved";

export interface SceneRow {
  sourceLine: number;
  title: string;
  prose: string;
  overlays: Scene["overlays"];
  state: SceneState;
  webmPath?: string;
  eventsPath?: string;
  capturedAt?: number;
  errorMessage?: string;
}

export interface EditorState {
  demoFile: string;
  scenes: SceneRow[];
  allApproved: boolean;
}

export type StateAction =
  | { type: "capture-start"; sceneIndex: number }
  | { type: "capture-done"; sceneIndex: number; webmPath: string; eventsPath?: string }
  | { type: "capture-error"; sceneIndex: number; message: string }
  | { type: "approve"; sceneIndex: number; approved: boolean }
  | { type: "scene-changed"; sceneIndex: number }
  | { type: "scenes-replaced"; scenes: Scene[] };
