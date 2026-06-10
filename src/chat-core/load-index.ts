import type { IndexedChunk, IndexFile } from "../types.js";
import type { LoadedIndex } from "./types.js";

export const DEFAULT_NO_MATCH_TEXT = "I don't have that in the demos. Try one of these:";

export interface LoadIndexOpts {
  suggestedQuestions: string[];
  defaultLocale: string;
  /** Lead text for canned no-match responses (validation failures, hard LLM
   *  errors, empty index). Localize/brand it here. */
  noMatchText?: string;
}

export function loadIndex(index: IndexFile, opts: LoadIndexOpts): LoadedIndex {
  if (index.version !== "v1") {
    throw new Error(`unsupported index version: ${index.version}`);
  }
  const stepLookup = new Map<string, IndexedChunk>();
  for (const c of index.chunks) stepLookup.set(c.stepId, c);
  return {
    index,
    stepLookup,
    videoBaseUrl: index.videoBaseUrl,
    suggestedQuestions: opts.suggestedQuestions,
    defaultLocale: opts.defaultLocale,
    noMatchText: opts.noMatchText ?? DEFAULT_NO_MATCH_TEXT,
  };
}
