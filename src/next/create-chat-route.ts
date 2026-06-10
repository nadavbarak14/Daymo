import type { IndexFile } from "../types.js";
import { answerChat } from "../chat-core/answer-chat.js";
import { loadIndex } from "../chat-core/load-index.js";
import { assertEmbeddingModel } from "../chat-core/embedding-guard.js";
import { createRateLimiter } from "../chat-server/rate-limit.js";
import type { AnswerFn, HelpChatEvent, RewriteQueryFn } from "../chat-core/types.js";

export interface CreateChatRouteOpts {
  index: IndexFile;
  embeddingModelId: string;
  embedQuery: (text: string) => Promise<number[]>;
  rewriteQuery: RewriteQueryFn;
  answer: AnswerFn;
  suggestedQuestions?: string[];
  defaultLocale?: string;
  /** Lead text for canned no-match responses. Localize/brand it here. */
  noMatchText?: string;
  rateLimitPerMinute?: number;
  maxBodyBytes?: number;
  onEvent?: (e: HelpChatEvent) => void;
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extra },
  });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}

let counter = 0;

export function createChatRoute(opts: CreateChatRouteOpts): (req: Request) => Promise<Response> {
  assertEmbeddingModel(opts.index.embeddingModel, opts.embeddingModelId);
  const loaded = loadIndex(opts.index, {
    suggestedQuestions: opts.suggestedQuestions ?? [],
    defaultLocale: opts.defaultLocale ?? "en",
    noMatchText: opts.noMatchText,
  });
  const limiter = createRateLimiter({ maxPerMinute: opts.rateLimitPerMinute ?? 30 });
  const maxBody = opts.maxBodyBytes ?? 1_000_000;

  return async function POST(req: Request): Promise<Response> {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > maxBody) return json(413, { error: "body too large" });

    const ip = clientIp(req);
    const decision = limiter.check(ip);
    if (!decision.allowed) {
      return json(429, { error: "rate limit exceeded" }, { "Retry-After": String(decision.retryAfterSec) });
    }

    let body: { message?: unknown; history?: unknown; locale?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return json(400, { error: "invalid body" });
    }
    if (typeof body.message !== "string" || !Array.isArray(body.history)) {
      return json(400, { error: "invalid body" });
    }

    const requestId = `req_${++counter}`;
    try {
      const result = await answerChat(
        {
          message: body.message,
          history: body.history as Array<{ role: "user" | "assistant"; content: string }>,
          locale: typeof body.locale === "string" ? body.locale : undefined,
          requestId,
        },
        {
          loaded,
          embedQuery: opts.embedQuery,
          rewriteQuery: opts.rewriteQuery,
          answer: opts.answer,
          onEvent: opts.onEvent,
        },
      );
      return json(result.status, result.body);
    } catch {
      opts.onEvent?.({
        requestId,
        question: String(body.message),
        rewrittenQueries: [],
        outcome: "error",
        matchedStepIds: [],
        topCosine: 0,
        latencyMs: 0,
      });
      return json(502, { error: "assistant unavailable" });
    }
  };
}
