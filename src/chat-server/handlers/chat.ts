import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatRequest, ChatResponse, IndexedChunk, Part, VideoPart } from "../../types.js";
import { retrieve } from "../retrieve.js";
import { extractKeywords } from "../../indexer/keywords.js";
import { validateChatResponse } from "../validate-response.js";
import { buildMp4Url } from "../mp4-url.js";
import type { CacheEntry } from "../index-cache.js";
import type { RewriteQueryFn, AnswerFn } from "../../chat-core/types.js";
export type { RewriteQueryFn, AnswerFn };

/** Below this top-cosine the answer model is told retrieval is weak — it
 *  prefers catalog-level answers or no_match. A signal, never a gate. */
const SCORE_THRESHOLD = 0.35;

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
  const catalog = entry.index.demos;

  // Nothing published → nothing to ground an answer in. Skip the LLM.
  if (entry.index.chunks.length === 0 && catalog.length === 0) {
    return sendJson(res, 200, noMatchWithSuggestions(entry.config));
  }

  // The rewrite is retrieval-only. It runs in parallel with embedding the raw
  // message so the always-on rewrite doesn't serialize the common path.
  const [rewrite, originalEmbedding] = await Promise.all([
    deps.rewriteQueryFn({ message: body.message, history, catalog }),
    deps.embedQueryFn(body.message),
  ]);
  const queries = rewrite.queries.slice(0, 2);
  const rewriteEmbeddings = await Promise.all(
    queries.map((q) => (q === body.message ? Promise.resolve(originalEmbedding) : deps.embedQueryFn(q))),
  );

  // Rewritten queries first (context-resolved), raw message last; union dedupes.
  const retrievals = [
    ...rewriteEmbeddings.map((embedding, i) => ({ embedding, keywords: extractKeywords(queries[i]) })),
    { embedding: originalEmbedding, keywords: extractKeywords(body.message) },
  ].map((query) => retrieve({ query, chunks: entry.index.chunks, k: 8 }));

  const seen = new Set<string>();
  const chunks: IndexedChunk[] = [];
  outer: for (const r of retrievals) {
    for (const c of r.chunks) {
      if (chunks.length >= 8) break outer;
      if (seen.has(c.stepId)) continue;
      seen.add(c.stepId);
      chunks.push(c);
    }
  }

  // Catalog-shaped question: make every demo citable by including its first
  // step (validation requires stepIds to come from chunks). Bounded by the
  // demo count, deliberately allowed past k=8.
  if (rewrite.catalogIntent) {
    for (const c of firstChunkPerDemo(entry.index.chunks)) {
      if (seen.has(c.stepId)) continue;
      seen.add(c.stepId);
      chunks.push(c);
    }
  }

  const topCosine = retrievals.reduce((m, r) => Math.max(m, r.topCosineScore), 0);
  const retrievalConfidence = topCosine < SCORE_THRESHOLD ? ("low" as const) : ("normal" as const);

  let response = await deps.answerFn({
    query: body.message,
    history,
    chunks,
    locale,
    catalog,
    retrievalConfidence,
  });

  // Empty text = the LLM layer's hard-failure marker (see answerWithChunks).
  if (response.kind === "no_match" && response.text === "") {
    return sendJson(res, 200, noMatchWithSuggestions(entry.config));
  }

  if (response.kind === "answer") {
    response = {
      kind: "answer",
      parts: response.parts.map((p): Part => {
        if (p.kind !== "video") return p;
        const v = p as VideoPart;
        // The model only chooses WHICH step to cite — the index is
        // authoritative for where that step lives. Models routinely fudge
        // startMs/endMs, so repair from the chunk instead of letting
        // validation refuse the whole answer over a few milliseconds.
        const chunk = entry.stepLookup.get(v.stepId);
        if (chunk) {
          return {
            ...v,
            demoId: chunk.demoId,
            startMs: chunk.globalStartMs,
            endMs: chunk.globalEndMs,
            mp4Url: buildMp4Url({ baseUrl: deps.baseUrl, widgetId: body.widgetId, demoId: chunk.demoId }),
          };
        }
        return { ...v, mp4Url: buildMp4Url({ baseUrl: deps.baseUrl, widgetId: body.widgetId, demoId: v.demoId }) };
      }),
    };
  }

  const validation = validateChatResponse(response, entry.stepLookup);
  if (!validation.ok) {
    return sendJson(res, 200, noMatchWithSuggestions(entry.config));
  }

  sendJson(res, 200, response);
}

function firstChunkPerDemo(chunks: IndexedChunk[]): IndexedChunk[] {
  const best = new Map<string, IndexedChunk>();
  for (const c of chunks) {
    const cur = best.get(c.demoId);
    if (!cur || c.globalStartMs < cur.globalStartMs) best.set(c.demoId, c);
  }
  return [...best.values()];
}

function noMatchWithSuggestions(config: { suggestedQuestions: string[]; noMatchText?: string }): ChatResponse {
  return {
    kind: "no_match",
    text: config.noMatchText ?? "I don't have that in the demos. Try one of these:",
    suggestions: config.suggestedQuestions.slice(0, 3),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
