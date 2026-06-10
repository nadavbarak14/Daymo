import type { HelpChatEvent } from "../chat-core/types.js";
import { createChatRoute } from "./create-chat-route.js";
import { createGeminiChatDeps } from "./gemini-deps.js";
import { loadIndexSource, type IndexSourceOpts } from "./load-index-source.js";

type Handler = (req: Request) => Promise<Response>;

export interface CreateHelpChatRouteOpts extends IndexSourceOpts {
  /** A Google Generative AI API key. The consumer owns this — Daymo never
   *  stores it. Read it from your own env (e.g. GOOGLE_GENERATIVE_AI_API_KEY). */
  apiKey: string;
  /** Embedding model for the query vector. Must match the model the index was
   *  built with. Defaults to Daymo's default (`gemini-embedding-001`). */
  embeddingModelId?: string;
  suggestedQuestions?: string[];
  defaultLocale?: string;
  /** Lead text for canned no-match responses. Localize/brand it here. */
  noMatchText?: string;
  rateLimitPerMinute?: number;
  maxBodyBytes?: number;
  onEvent?: (e: HelpChatEvent) => void;
}

/**
 * One-call chat route for the help center. Wraps everything a consumer would
 * otherwise hand-write: resolving the index (explicit object, `baseUrl`,
 * `HELP_BASE_URL`, or same-origin `/help/index.json`), building the Gemini deps
 * from an apiKey, memoizing across warm requests, and turning a cold-start
 * failure into a 503 that retries on the next call. Host-agnostic — returns a
 * standard `(Request) => Response` handler.
 *
 *   export const POST = createHelpChatRoute({
 *     apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
 *   });
 */
export function createHelpChatRoute(opts: CreateHelpChatRouteOpts): Handler {
  if (!opts.apiKey) {
    throw new Error("createHelpChatRoute: `apiKey` is required");
  }

  let handlerPromise: Promise<Handler> | null = null;

  function build(req: Request): Promise<Handler> {
    return (async () => {
      const index = await loadIndexSource(opts, req.url);
      const deps = createGeminiChatDeps({ apiKey: opts.apiKey, embeddingModelId: opts.embeddingModelId });
      return createChatRoute({
        index,
        ...deps,
        suggestedQuestions: opts.suggestedQuestions,
        defaultLocale: opts.defaultLocale,
        noMatchText: opts.noMatchText,
        rateLimitPerMinute: opts.rateLimitPerMinute,
        maxBodyBytes: opts.maxBodyBytes,
        onEvent: opts.onEvent,
      });
    })();
  }

  return async function POST(req: Request): Promise<Response> {
    try {
      if (!handlerPromise) handlerPromise = build(req);
      const handler = await handlerPromise;
      return handler(req);
    } catch (err) {
      // Reset so a transient cold-start failure (e.g. index fetch) can retry.
      handlerPromise = null;
      const message = err instanceof Error ? err.message : "help unavailable";
      return new Response(JSON.stringify({ error: message }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
  };
}
