import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatRequest, ChatResponse, Part, VideoPart } from "../../types.js";
import { retrieve } from "../retrieve.js";
import { extractKeywords } from "../../indexer/keywords.js";
import { validateChatResponse } from "../validate-response.js";
import { buildMp4Url } from "../mp4-url.js";
import type { CacheEntry } from "../index-cache.js";

const SCORE_THRESHOLD = 0.55;

export type RewriteQueryFn = (input: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) => Promise<string>;

export type AnswerFn = (input: {
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: import("../../types.js").IndexedChunk[];
  locale: string;
}) => Promise<ChatResponse>;

export interface ChatHandlerDeps {
  loadWidget: (id: string) => Promise<CacheEntry>;
  rewriteQueryFn: RewriteQueryFn;
  answerFn: AnswerFn;
  embedQueryFn: (text: string) => Promise<number[]>;
  baseUrl: string;
}

export async function handleChat(
  _req: IncomingMessage,
  res: ServerResponse,
  body: ChatRequest,
  deps: ChatHandlerDeps,
): Promise<void> {
  let entry: CacheEntry;
  try {
    entry = await deps.loadWidget(body.widgetId);
  } catch {
    return sendJson(res, 404, { kind: "no_match", text: "This help widget is not configured." });
  }

  const locale = body.locale ?? entry.config.locale;
  const history = body.history.slice(-2);

  const rewritten = history.length === 0
    ? body.message
    : await deps.rewriteQueryFn({ message: body.message, history });

  const queryEmbedding = await deps.embedQueryFn(rewritten);
  const queryKeywords = extractKeywords(rewritten);
  const retrieval = retrieve({
    query: { embedding: queryEmbedding, keywords: queryKeywords },
    chunks: entry.index.chunks,
    k: 8,
  });

  if (retrieval.topCosineScore < SCORE_THRESHOLD) {
    return sendJson(res, 200, noMatchWithSuggestions(entry.config.suggestedQuestions));
  }

  let response = await deps.answerFn({
    query: rewritten,
    history,
    chunks: retrieval.chunks,
    locale,
  });

  if (response.kind === "answer") {
    response = {
      kind: "answer",
      parts: response.parts.map((p): Part => {
        if (p.kind !== "video") return p;
        const v = p as VideoPart;
        return {
          ...v,
          mp4Url: buildMp4Url({ baseUrl: deps.baseUrl, widgetId: body.widgetId, demoId: v.demoId }),
        };
      }),
    };
  }
  const validation = validateChatResponse(response, entry.stepLookup);
  if (!validation.ok) {
    response = noMatchWithSuggestions(entry.config.suggestedQuestions);
  }

  sendJson(res, 200, response);
}

function noMatchWithSuggestions(suggestions: string[]): ChatResponse {
  return {
    kind: "no_match",
    text: "I don't have that in the demos. Try one of these:",
    suggestions: suggestions.slice(0, 3),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
