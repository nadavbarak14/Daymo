export type SceneState = "pending" | "captured" | "approved";
export interface OverlayDirective {
  type: "callout" | "highlight";
  target?: string;
  text?: string;
  duration?: string;
  [k: string]: unknown;
}
export interface SceneRow {
  sourceLine: number;
  title: string;
  prose: string;
  overlays: OverlayDirective[];
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
