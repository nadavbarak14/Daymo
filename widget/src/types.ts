export interface ChatRequest {
  widgetId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  locale?: string;
}

export type TextPart = { kind: "text"; text: string };
export type VideoPart = {
  kind: "video";
  stepId: string;
  demoId: string;
  startMs: number;
  endMs: number;
  caption: string;
  mp4Url: string;
};
export type Part = TextPart | VideoPart;

export type ChatResponse =
  | { kind: "answer"; parts: Part[] }
  | { kind: "no_match"; text: string; suggestions?: string[] };

export interface WidgetConfigResp {
  widgetId: string;
  name: string;
  brandColor?: string;
  locale: string;
  suggestedQuestions: string[];
  /** Shipped theme name ("aurelia" | "lume" | "onyx"); data-theme on the script tag wins. */
  theme?: string;
  /** Launcher bubble icon preset ("chat" | "help" | "play" | "book" | "life-ring"). Defaults to "chat". */
  bubbleIcon?: string;
  /** Launcher bubble background color (CSS color). Overrides brandColor for the bubble only, so the panel can stay on-brand while the bubble is visually distinct. */
  bubbleColor?: string;
  /** URL of the published help-center manifest.json — lets the widget reuse the help page's videos/posters. */
  manifestUrl?: string;
}
