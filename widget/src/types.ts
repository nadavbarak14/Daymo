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
}
