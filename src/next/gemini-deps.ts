import {
  rewriteQuery as geminiRewriteQuery,
  answerWithChunks as geminiAnswerWithChunks,
} from "../chat-server/llm.js";
import {
  embedQuery as geminiEmbedQuery,
  DEFAULT_EMBEDDING_MODEL,
} from "../indexer/embedder-gemini.js";
import type { AnswerFn, RewriteQueryFn } from "../chat-core/types.js";

/** The three retrieval/LLM functions `createChatRoute` needs, plus the
 *  embedding model id that produced the index (used by the embedding guard). */
export interface GeminiChatDeps {
  embeddingModelId: string;
  embedQuery: (text: string) => Promise<number[]>;
  rewriteQuery: RewriteQueryFn;
  answer: AnswerFn;
}

export interface GeminiChatDepsOpts {
  /** A Google Generative AI API key. The consumer owns this — Daymo never
   *  stores it. Read it from your own env (e.g. GOOGLE_GENERATIVE_AI_API_KEY). */
  apiKey: string;
  /** Embedding model used for the query vector. MUST match the model the index
   *  was built with — the route asserts this against `index.embeddingModel`.
   *  Defaults to Daymo's default (`gemini-embedding-001`). */
  embeddingModelId?: string;
}

/**
 * Ready-made Gemini-backed deps so a consumer's chat route is a few lines:
 *
 *   const deps = createGeminiChatDeps({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! });
 *   export const POST = createChatRoute({ index, ...deps });
 *
 * Query rewrite and answer use `gemini-2.5-flash`; embeddings use
 * `gemini-embedding-001` by default. Provider-agnostic by construction: swap
 * this factory for your own `{ embedQuery, rewriteQuery, answer }` to use any
 * model/provider.
 */
export function createGeminiChatDeps(opts: GeminiChatDepsOpts): GeminiChatDeps {
  if (!opts.apiKey) {
    throw new Error("createGeminiChatDeps: `apiKey` is required");
  }
  const embeddingModelId = opts.embeddingModelId ?? DEFAULT_EMBEDDING_MODEL;
  return {
    embeddingModelId,
    embedQuery: (text) =>
      geminiEmbedQuery(text, { apiKey: opts.apiKey, model: embeddingModelId }),
    rewriteQuery: (input) => geminiRewriteQuery(input, { apiKey: opts.apiKey }),
    answer: (input) => geminiAnswerWithChunks(input, { apiKey: opts.apiKey }),
  };
}
