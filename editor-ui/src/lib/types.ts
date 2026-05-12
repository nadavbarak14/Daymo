export type SceneState = "pending" | "captured";
export interface OverlayDirective {
  type: "callout" | "highlight";
  target?: string;
  text?: string;
  duration?: string;
  [k: string]: unknown;
}
export interface SourceSpan { start: number; end: number; line: number }
export interface StepLiteral { text: string; span: SourceSpan }
export interface Step {
  description?: string;
  descriptionSpan?: SourceSpan;
  says: StepLiteral[];
  banners: StepLiteral[];
}
export interface SceneRow {
  sourceLine: number;
  title: string;
  prose: string;
  overlays: OverlayDirective[];
  steps: Step[];
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
