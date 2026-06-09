import type { ChatResponse, IndexedChunk, IndexedDemo, IndexFile } from "../types.js";

export interface LoadedIndex {
  index: IndexFile;
  stepLookup: Map<string, IndexedChunk>;
  videoBaseUrl: string;
  suggestedQuestions: string[];
  defaultLocale: string;
  noMatchText: string;
}

export interface CoreInput {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  locale?: string;
  requestId: string;
}

export interface RewriteResult {
  /** 1-2 self-contained search strings (retrieval-only — never shown to the answer model as the user's message). */
  queries: string[];
  /** True for "what's available / what can I do here"-shaped questions. */
  catalogIntent: boolean;
}

export type RewriteQueryFn = (input: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  catalog: IndexedDemo[];
}) => Promise<RewriteResult>;

export type AnswerFn = (input: {
  /** The user's ORIGINAL message — language detection depends on this. */
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
  catalog: IndexedDemo[];
  retrievalConfidence: "low" | "normal";
}) => Promise<ChatResponse>;

export interface HelpChatEvent {
  requestId: string;
  question: string;
  rewrittenQueries: string[];
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
