import type { ChatResponse, IndexedChunk, Part, VideoPart } from "../types.js";
import { retrieve } from "../chat-server/retrieve.js";
import { extractKeywords } from "../indexer/keywords.js";
import { validateChatResponse } from "../chat-server/validate-response.js";
import type { CoreDeps, CoreInput, CoreResult, HelpChatEvent, LoadedIndex } from "./types.js";

/** Below this top-cosine the answer model is told retrieval is weak — it
 *  prefers catalog-level answers or no_match. A signal, never a gate. */
const SCORE_THRESHOLD = 0.35;

export async function answerChat(input: CoreInput, deps: CoreDeps): Promise<CoreResult> {
  const startedAt = performance.now();
  const { loaded } = deps;
  const locale = input.locale ?? loaded.defaultLocale;
  const history = input.history.slice(-2);
  const catalog = loaded.index.demos;

  const emit = (
    outcome: HelpChatEvent["outcome"],
    rewrittenQueries: string[],
    topCosine: number,
    stepIds: string[],
  ): void => {
    deps.onEvent?.({
      requestId: input.requestId,
      question: input.message,
      rewrittenQueries,
      outcome,
      matchedStepIds: stepIds,
      topCosine,
      latencyMs: Math.round(performance.now() - startedAt),
    });
  };

  // Nothing published → nothing to ground an answer in. Skip the LLM.
  if (loaded.index.chunks.length === 0 && catalog.length === 0) {
    emit("no_match", [], 0, []);
    return { status: 200, body: noMatch(loaded) };
  }

  // The rewrite is retrieval-only. It runs in parallel with embedding the raw
  // message so the always-on rewrite doesn't serialize the common path.
  const [rewrite, originalEmbedding] = await Promise.all([
    deps.rewriteQuery({ message: input.message, history, catalog }),
    deps.embedQuery(input.message),
  ]);
  const queries = rewrite.queries.slice(0, 2);
  const rewriteEmbeddings = await Promise.all(
    queries.map((q) => (q === input.message ? Promise.resolve(originalEmbedding) : deps.embedQuery(q))),
  );

  // Rewritten queries first (context-resolved), raw message last; union dedupes.
  const retrievals = [
    ...rewriteEmbeddings.map((embedding, i) => ({ embedding, keywords: extractKeywords(queries[i]) })),
    { embedding: originalEmbedding, keywords: extractKeywords(input.message) },
  ].map((query) => retrieve({ query, chunks: loaded.index.chunks, k: 8 }));

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
    for (const c of firstChunkPerDemo(loaded.index.chunks)) {
      if (seen.has(c.stepId)) continue;
      seen.add(c.stepId);
      chunks.push(c);
    }
  }

  const topCosine = retrievals.reduce((m, r) => Math.max(m, r.topCosineScore), 0);
  const retrievalConfidence = topCosine < SCORE_THRESHOLD ? ("low" as const) : ("normal" as const);

  let response = await deps.answer({
    query: input.message,
    history,
    chunks,
    locale,
    catalog,
    retrievalConfidence,
  });

  // Empty text = the LLM layer's hard-failure marker (see answerWithChunks).
  if (response.kind === "no_match" && response.text === "") {
    emit("no_match", queries, topCosine, []);
    return { status: 200, body: noMatch(loaded) };
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
        const chunk = loaded.stepLookup.get(v.stepId);
        if (chunk) {
          return {
            ...v,
            demoId: chunk.demoId,
            startMs: chunk.globalStartMs,
            endMs: chunk.globalEndMs,
            mp4Url: `${loaded.videoBaseUrl}/${chunk.demoId}/output.mp4`,
          };
        }
        return { ...v, mp4Url: `${loaded.videoBaseUrl}/${v.demoId}/output.mp4` };
      }),
    };
  }

  const validation = validateChatResponse(response, loaded.stepLookup);
  if (!validation.ok) {
    emit("no_match", queries, topCosine, []);
    return { status: 200, body: noMatch(loaded) };
  }

  const stepIds =
    response.kind === "answer"
      ? response.parts.filter((p): p is VideoPart => p.kind === "video").map((p) => p.stepId)
      : [];
  emit(response.kind === "answer" ? "answered" : "no_match", queries, topCosine, stepIds);
  return { status: 200, body: response };
}

function firstChunkPerDemo(chunks: IndexedChunk[]): IndexedChunk[] {
  const best = new Map<string, IndexedChunk>();
  for (const c of chunks) {
    const cur = best.get(c.demoId);
    if (!cur || c.globalStartMs < cur.globalStartMs) best.set(c.demoId, c);
  }
  return [...best.values()];
}

function noMatch(loaded: LoadedIndex): ChatResponse {
  return {
    kind: "no_match",
    text: loaded.noMatchText,
    suggestions: loaded.suggestedQuestions.slice(0, 3),
  };
}
