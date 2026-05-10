export type { WordTiming } from "./tts/provider.js";

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

export interface Scene {
  /** 1-based line number in the source where the heading sits. */
  sourceLine: number;
  title: string;
  prose: string;
  playwrightCode?: { code: string; sourceLine: number };
  overlays: OverlayDirective[];
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
  | { kind: "say"; t: number; hash: string; text: string; durationMs: number }
  | { kind: "overlay"; t: number; directive: OverlayDirective; bbox: BBox | null }
  | { kind: "log"; t: number; level: "log" | "warn" | "error"; args: unknown[] }
  | { kind: "error"; t: number; message: string; sceneIndex: number };

export interface BBox { x: number; y: number; width: number; height: number }

export interface DemoFx {
  cursorTo(selector: string, opts?: { duration?: number }): Promise<void>;
  typeWithDelay(selector: string, text: string, cps?: number): Promise<void>;
  zoom(selector: string, factor?: number, duration?: number): Promise<void>;
  pause(seconds: number): Promise<void>;
  callout(text: string, target?: string, duration?: number): Promise<void>;
  highlight(selector: string, duration?: number): Promise<void>;
  say(text: string, opts?: { voice?: string; rate?: string }): Promise<void>;
  banner(text: string, opts?: { duration?: number; title?: string }): Promise<void>;
  hideBanner(): Promise<void>;
}

export interface ArtifactPaths {
  dir: string;
  rawVideo: string;       // raw_page.webm
  events: string;         // events.json
  output: string;         // output.mp4
}
