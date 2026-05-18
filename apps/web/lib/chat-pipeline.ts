import type { ChatRequest, ChatResponse, IndexJson, Part } from "../../../src/core/index-types.js";
import { cosineTopK, isBelowScoreGate } from "./retrieval.js";
import type { GeminiClient } from "./gemini.js";

const NO_MATCH_FALLBACK = "I don't have that in the demos. Try one of these:";

const MAX_PARTS = 6;
const MAX_VIDEO_PARTS = 3;
const TOP_K = 8;

export interface ChatPipelineDeps {
  request: ChatRequest;
  index: IndexJson;
  mp4UrlFor: (demoId: string) => Promise<string>;
  gemini: GeminiClient;
}

export async function runChatPipeline(deps: ChatPipelineDeps): Promise<ChatResponse> {
  const { request, index, mp4UrlFor, gemini } = deps;
  const locale = request.locale ?? "en";
  const history = request.history.slice(-2);

  // 1. Rewrite
  const rewritten = await gemini.rewriteQuery(request.message, history);

  // 2. Embed + retrieve
  const queryEmb = await gemini.embedQuery(rewritten);
  const topK = cosineTopK(queryEmb, index.chunks, TOP_K);

  // 3. Score gate
  if (isBelowScoreGate(topK)) {
    return { kind: "no_match", text: NO_MATCH_FALLBACK, suggestions: suggestionsFor(index) };
  }

  // 4. Answer LLM
  const chunksForLLM = await Promise.all(topK.map(async ({ chunk }) => ({
    stepId: chunk.stepId, demoId: chunk.demoId, text: chunk.text,
    caption: chunk.text.split("\n").pop() ?? "",
    mp4Url: await mp4UrlFor(chunk.demoId),
    startMs: chunk.globalStartMs, endMs: chunk.globalEndMs,
  })));
  const llmAnswer = await gemini.answer({ message: request.message, history, locale, chunks: chunksForLLM });

  // 5. Server validation
  if (llmAnswer.kind === "no_match") return llmAnswer;
  const validated = validateAnswer(llmAnswer.parts, index);
  if (!validated.ok) return { kind: "no_match", text: NO_MATCH_FALLBACK, suggestions: suggestionsFor(index) };
  return { kind: "answer", parts: validated.parts };
}

function validateAnswer(parts: Part[], index: IndexJson): { ok: false } | { ok: true; parts: Part[] } {
  if (parts.length === 0 || parts.length > MAX_PARTS) return { ok: false };
  const videos = parts.filter((p) => p.kind === "video");
  if (videos.length > MAX_VIDEO_PARTS) return { ok: false };
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].kind === "video" && parts[i - 1].kind === "video") return { ok: false };
  }
  for (const p of parts) {
    if (p.kind === "video") {
      const c = index.chunks.find((x) => x.stepId === p.stepId);
      if (!c) return { ok: false };
      // Reject if start/end don't match the index's known window.
      if (p.startMs !== c.globalStartMs || p.endMs !== c.globalEndMs) return { ok: false };
    }
  }
  return { ok: true, parts };
}

function suggestionsFor(index: IndexJson): string[] {
  const fromSteps = index.chunks
    .map((c) => c.text.split("\n").find((l) => l.startsWith("[Step] "))?.replace("[Step] ", ""))
    .filter((s): s is string => !!s && s !== "(preamble)");
  return Array.from(new Set(fromSteps)).slice(0, 3).map((s) => `How do I ${s.toLowerCase()}?`);
}
