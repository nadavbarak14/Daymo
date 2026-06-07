import type { ChatResponse, Part, VideoPart } from "../types.js";
import { retrieve } from "../chat-server/retrieve.js";
import { extractKeywords } from "../indexer/keywords.js";
import { validateChatResponse } from "../chat-server/validate-response.js";
import type { CoreDeps, CoreInput, CoreResult, HelpChatEvent } from "./types.js";

const SCORE_THRESHOLD = 0.35;

export async function answerChat(input: CoreInput, deps: CoreDeps): Promise<CoreResult> {
  const startedAt = performance.now();
  const { loaded } = deps;
  const locale = input.locale ?? loaded.defaultLocale;
  const history = input.history.slice(-2);

  const emit = (
    outcome: HelpChatEvent["outcome"],
    rewritten: string,
    topCosine: number,
    stepIds: string[],
  ): void => {
    deps.onEvent?.({
      requestId: input.requestId,
      question: input.message,
      rewrittenQuery: rewritten,
      outcome,
      matchedStepIds: stepIds,
      topCosine,
      latencyMs: Math.round(performance.now() - startedAt),
    });
  };

  const rewritten =
    history.length === 0 ? input.message : await deps.rewriteQuery({ message: input.message, history });

  const queryEmbedding = await deps.embedQuery(rewritten);
  const retrieval = retrieve({
    query: { embedding: queryEmbedding, keywords: extractKeywords(rewritten) },
    chunks: loaded.index.chunks,
    k: 8,
  });

  if (retrieval.topCosineScore < SCORE_THRESHOLD) {
    emit("no_match", rewritten, retrieval.topCosineScore, []);
    return { status: 200, body: noMatch(loaded.suggestedQuestions) };
  }

  let response = await deps.answer({ query: rewritten, history, chunks: retrieval.chunks, locale });

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
    emit("no_match", rewritten, retrieval.topCosineScore, []);
    return { status: 200, body: noMatch(loaded.suggestedQuestions) };
  }

  const stepIds =
    response.kind === "answer"
      ? response.parts.filter((p): p is VideoPart => p.kind === "video").map((p) => p.stepId)
      : [];
  emit(response.kind === "answer" ? "answered" : "no_match", rewritten, retrieval.topCosineScore, stepIds);
  return { status: 200, body: response };
}

function noMatch(suggestions: string[]): ChatResponse {
  return {
    kind: "no_match",
    text: "I don't have that in the demos. Try one of these:",
    suggestions: suggestions.slice(0, 3),
  };
}
