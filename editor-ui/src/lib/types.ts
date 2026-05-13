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
export interface ActionLiteral {
  selector: string;
  selectorSpan: SourceSpan;
  description: string;
  descriptionSpan: SourceSpan;
}
export interface Step {
  description?: string;
  descriptionSpan?: SourceSpan;
  says: StepLiteral[];
  banners: StepLiteral[];
  types: StepLiteral[];
  highlights: ActionLiteral[];
  clicks: ActionLiteral[];
  cursors: ActionLiteral[];
}
export interface SceneRow {
  sourceLine: number;
  title: string;
  prose: string;
  overlays: OverlayDirective[];
  steps: Step[];
  /** Parallel to steps[]. Each entry is ms from the scene's webm start to when
   *  the step fires. Populated after capture; absent on uncaptured scenes. */
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
