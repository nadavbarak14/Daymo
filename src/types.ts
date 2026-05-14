import type { WordTiming } from "./tts/provider.js";
export type { WordTiming };

export interface TtsConfig {
  provider: "edge";
  voice: string;
  rate: string;
  music_duck: boolean;
}

export interface Frontmatter {
  title: string;
  description?: string;
  url: string;
  viewport?: { width: number; height: number };
  music?: string;
  mocks?: MockSourceConfig[];
  auth?: { storageState: string };
  tts: TtsConfig;     // always populated post-parse (with defaults)
}

export type MockSourceConfig =
  | { source: "inline"; routes?: Record<string, MockRouteResponse>; file?: string };

export type MockRouteResponse =
  | unknown // raw JSON body, defaults to status 200, content-type application/json
  | { status?: number; headers?: Record<string, string>; body: unknown };

export interface OverlayDirective {
  type: "callout" | "highlight";
  target?: string;
  text?: string;
  duration?: string; // "2.5s"
  // forward-compatible: extra fields ignored
  [key: string]: unknown;
}

export interface SourceSpan {
  /** Byte offset within the full .demo file. */
  start: number;
  /** Exclusive byte offset within the full .demo file. */
  end: number;
  /** 1-based line within the .demo file (for error messages). */
  line: number;
}

export interface StepLiteral {
  text: string;
  span: SourceSpan;
}

/** Action-style call (highlight/click/cursorTo): the first arg is the
 *  selector and the second is a human-readable description. The editor
 *  surfaces the description in the step rail so authors can see what each
 *  action is for without needing to mentally translate a CSS selector. */
export interface ActionLiteral {
  selector: string;
  selectorSpan: SourceSpan;
  description: string;
  descriptionSpan: SourceSpan;
}

export interface Step {
  /** Author description (the fx.step("...") literal). undefined for the implicit
   *  preamble that wraps statements appearing before the first fx.step call. */
  description?: string;
  descriptionSpan?: SourceSpan;
  /** 0 or 1 entries — enforced by parser invariant. */
  says: StepLiteral[];
  /** 0 or 1 entries — enforced by parser invariant. */
  banners: StepLiteral[];
  /** Each fx.typeWithDelay(selector, text, ...) literal that belongs to this
   *  step, in source order. No upper-bound invariant — typing into multiple
   *  fields in one step is normal. */
  types: StepLiteral[];
  /** fx.highlight(selector, description, opts?) calls in source order. */
  highlights: ActionLiteral[];
  /** fx.click(selector, description, opts?) and page.click(selector) calls
   *  in source order. page.click contributes an entry with empty description. */
  clicks: ActionLiteral[];
  /** fx.cursorTo(selector, description, opts?) calls in source order. */
  cursors: ActionLiteral[];
}

export interface StepRuntime {
  /** ms from the start of the scene's webm to when this step fires (the
   *  `step` event's timestamp). Populated after capture from events.json. */
  t: number;
}

export interface Scene {
  /** 1-based line number in the source where the heading sits. */
  sourceLine: number;
  title: string;
  prose: string;
  playwrightCode?: { code: string; sourceLine: number };
  overlays: OverlayDirective[];
  /** Always length >= 1. steps[0] is the implicit preamble (no description).
   *  Each explicit fx.step() call appends a new entry. */
  steps: Step[];
}

export interface DemoAst {
  frontmatter: Frontmatter;
  scenes: Scene[];
}

/** Event log entry written to events.json by the controller. */
export type RunnerEvent =
  | { kind: "scene_start"; t: number; index: number; title: string; prose: string; recordingOffsetMs?: number }
  | { kind: "scene_end"; t: number; index: number }
  | { kind: "fx"; t: number; method: string; args: unknown[] }
  | { kind: "say"; t: number; hash: string; text: string; durationMs: number; words: WordTiming[] }
  | { kind: "step"; t: number; sceneIndex: number; stepIndex: number; description: string }
  | { kind: "overlay"; t: number; directive: OverlayDirective; bbox: BBox | null }
  | { kind: "log"; t: number; level: "log" | "warn" | "error"; args: unknown[] }
  | { kind: "error"; t: number; message: string; sceneIndex: number };

export interface BBox { x: number; y: number; width: number; height: number }

export interface DemoFx {
  /** Move the cursor over a selector. `description` is a human label shown in
   *  the editor rail (e.g. "the title link"). */
  cursorTo(selector: string, description: string, opts?: { duration?: number }): Promise<void>;
  typeWithDelay(selector: string, text: string, cps?: number): Promise<void>;
  zoom(selector: string, factor?: number, duration?: number): Promise<void>;
  pause(seconds: number): Promise<void>;
  callout(text: string, target?: string, duration?: number): Promise<void>;
  /** Highlight a selector. `description` is mandatory; `opts.color` overrides
   *  the default red outline (any CSS color). */
  highlight(selector: string, description: string, opts?: { duration?: number; color?: string }): Promise<void>;
  /** Click a selector. `description` is mandatory and appears in the rail. */
  click(selector: string, description: string, opts?: { delay?: number; button?: "left" | "right" | "middle" }): Promise<void>;
  say(text: string, opts?: { voice?: string; rate?: string }): Promise<void>;
  banner(text: string, opts?: { duration?: number; title?: string }): Promise<void>;
  hideBanner(): Promise<void>;
  step(description: string): Promise<void>;
  waitForSelector(
    selector: string,
    opts?: { state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number },
  ): Promise<void>;
  waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
  waitForURL(url: string | RegExp, opts?: { timeout?: number }): Promise<void>;
}

export interface ArtifactPaths {
  dir: string;
  rawVideo: string;       // raw_page.webm
  events: string;         // events.json
  output: string;         // output.mp4
}

/** One entry per scene in the stitched output.mp4. globalEndMs is exclusive. */
export interface SceneIndexEntry {
  sceneIndex: number;
  globalStartMs: number;
  globalEndMs: number;
  recordingOffsetMs: number;
}

/** One entry per step (including implicit preamble at stepIndex=0). */
export interface StepIndexEntry {
  stepId: string;
  sceneIndex: number;
  stepIndex: number;
  description: string;
  globalStartMs: number;
  globalEndMs: number;
}

export interface StepIndex {
  demoId: string;
  mp4DurationMs: number;
  scenes: SceneIndexEntry[];
  steps: StepIndexEntry[];
}

export interface SceneForStepIndex {
  sceneIndex: number;
  recordingOffsetMs: number;
  trimmedDurationMs: number;
  events: RunnerEvent[];
}
