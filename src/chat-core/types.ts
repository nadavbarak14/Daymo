import type { ChatResponse, IndexedChunk, IndexFile } from "../types.js";

export interface LoadedIndex {
  index: IndexFile;
  stepLookup: Map<string, IndexedChunk>;
  videoBaseUrl: string;
  suggestedQuestions: string[];
  defaultLocale: string;
}

export interface CoreInput {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  locale?: string;
  requestId: string;
}

export type RewriteQueryFn = (input: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) => Promise<string>;

export type AnswerFn = (input: {
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
}) => Promise<ChatResponse>;

export interface HelpChatEvent {
  requestId: string;
  question: string;
  rewrittenQuery: string;
  outcome: "answered" | "no_match" | "error";
  matchedStepIds: string[];
  topCosine: number;
  latencyMs: number;
}

export interface CoreDeps {
  loaded: LoadedIndex;
  embedQuery: (text: string) => Promise<number[]>;
  rewriteQuery: RewriteQueryFn;
  answer: AnswerFn;
  onEvent?: (e: HelpChatEvent) => void;
}

export interface CoreResult {
  status: 200;
  body: ChatResponse;
}
