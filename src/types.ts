export interface Frontmatter {
  title: string;
  description?: string;
  url: string;
  viewport?: { width: number; height: number };
  music?: string;
  mocks?: MockSourceConfig[];
  auth?: { storageState: string };
  // v0.2:
  defaultTransition?: TransitionType;
  transitionDuration?: string;       // "0.5s"
  intro?: SlateInput;
  outro?: SlateInput;
  captureMode?: CaptureMode;
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

export interface Scene {
  /** 1-based line number in the source where the heading sits. */
  sourceLine: number;
  title: string;
  prose: string;
  playwrightCode?: { code: string; sourceLine: number };
  overlays: OverlayDirective[];
  // v0.2:
  transition?: TransitionConfig;     // overrides defaultTransition
  sceneConfig?: SceneOverrides;      // legal only when captureMode: per-scene
}

export interface DemoAst {
  frontmatter: Frontmatter;
  scenes: Scene[];
}

/** Event log entry written to events.json by the controller. */
export type RunnerEvent =
  | { kind: "scene_start"; t: number; index: number; title: string; prose: string }
  | { kind: "scene_end"; t: number; index: number }
  | { kind: "fx"; t: number; method: string; args: unknown[] }
  | { kind: "overlay"; t: number; directive: OverlayDirective; bbox: BBox | null }
  | { kind: "log"; t: number; level: "log" | "warn" | "error"; args: unknown[] }
  | { kind: "error"; t: number; message: string; sceneIndex: number }
  | { kind: "fast_forward_start"; t: number; sceneIndex: number; factor: number }
  | { kind: "fast_forward_end"; t: number; sceneIndex: number }
  | { kind: "skip_start"; t: number; sceneIndex: number }
  | { kind: "skip_end"; t: number; sceneIndex: number };

export interface BBox { x: number; y: number; width: number; height: number }

export interface DemoFx {
  cursorTo(selector: string, opts?: { duration?: number }): Promise<void>;
  typeWithDelay(selector: string, text: string, cps?: number): Promise<void>;
  zoom(selector: string, factor?: number, duration?: number): Promise<void>;
  pause(seconds: number): Promise<void>;
  callout(text: string, target?: string, duration?: number): Promise<void>;
  highlight(selector: string, duration?: number): Promise<void>;
  // v0.2:
  fastForward<T>(fn: () => Promise<T>, factor?: number): Promise<T>;
  skip<T>(fn: () => Promise<T>): Promise<T>;
}

export interface ArtifactPaths {
  dir: string;
  rawVideo: string;       // raw_page.webm
  events: string;         // events.json
  output: string;         // output.mp4
}

// v0.2 types

export type TransitionType =
  | "crossfade"
  | "dip-to-black"
  | "slide-left"
  | "slide-right"
  | "none";

export interface TransitionConfig {
  type: TransitionType;
  durationMs: number;
}

export type CaptureMode = "continuous" | "per-scene";

export interface SlateConfig {
  durationMs: number;
  background: string;
  accent: string;
  logo?: string;          // absolute path resolved by runner from .demo basedir
  title?: string;         // override of frontmatter title
  subtitle?: string;      // override of frontmatter description (intro)
  text?: string;          // outro footer text
}

/** `false` means "disabled". `undefined` means "use built-in default". */
export type SlateInput = SlateConfig | false | undefined;

export interface SceneOverrides {
  url?: string;
  mocks?: MockSourceConfig[];
  auth?: { storageState: string };
}
