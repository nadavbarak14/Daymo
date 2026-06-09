import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { IndexedChunk, IndexedDemo, ChatResponse, Part } from "../types.js";
import type { RewriteResult } from "../chat-core/types.js";

const REWRITE_MODEL = "gemini-2.5-flash";
const ANSWER_MODEL = "gemini-2.5-flash";

export interface LlmOpts {
  apiKey: string;
}

function renderCatalog(catalog: IndexedDemo[]): string {
  if (catalog.length === 0) return "(no demos published)";
  return catalog
    .map((d) => `- ${d.demoId}: ${d.title} — ${d.description}`)
    .join("\n");
}

function rewriteSystem(catalog: IndexedDemo[]): string {
  return `You turn the user's latest message into search queries over a library of product demo videos.

Output:
- queries: 1-2 self-contained search strings capturing the user's full intent. Resolve pronouns and follow-ups from the conversation ("how do I share it?" after a course question → "share a course"). One focused question → ONE query. A question spanning two distinct topics → TWO queries. Each <=30 tokens, in English.
- catalogIntent: true when the user asks what's available or what they can do in general ("what can I do here?", "what are my options?", "what do you cover?") rather than how to do one specific thing.

Demo library (context for resolving what the user means):
${renderCatalog(catalog)}`;
}

const RewriteSchema = z.object({
  queries: z.array(z.string()).min(1).max(2),
  catalogIntent: z.boolean(),
});

export interface RewriteQueryInput {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  catalog: IndexedDemo[];
}

export async function rewriteQuery(input: RewriteQueryInput, opts: LlmOpts): Promise<RewriteResult> {
  const google = createGoogleGenerativeAI({ apiKey: opts.apiKey });
  const historyText = input.history.map((t) => `${t.role}: ${t.content}`).join("\n");
  const userBlock = [
    historyText ? `Conversation so far:\n${historyText}\n` : "",
    `Latest message: ${input.message}`,
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: google(REWRITE_MODEL),
      schema: RewriteSchema,
      system: rewriteSystem(input.catalog),
      prompt: userBlock,
      maxTokens: 200,
      temperature: 0.0,
    });
    const queries = object.queries
      .map((q) => q.trim().replace(/^["'`]+|["'`]+$/g, "").trim())
      .filter(Boolean);
    if (queries.length === 0) return { queries: [input.message], catalogIntent: false };
    return { queries, catalogIntent: object.catalogIntent };
  } catch {
    // Fail open: retrieval falls back to the raw message; never block the answer.
    return { queries: [input.message], catalogIntent: false };
  }
}

// Zod schema for ChatResponse — gets enforced by the model via generateObject
const TextPartSchema = z.object({
  kind: z.literal("text"),
  text: z.string(),
});
const VideoPartSchema = z.object({
  kind: z.literal("video"),
  stepId: z.string(),
  demoId: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  caption: z.string(),
  mp4Url: z.string(),
});
const PartSchema = z.discriminatedUnion("kind", [TextPartSchema, VideoPartSchema]);

// No .max() on parts: Gemini's structured output does not reliably honor
// maxItems, so an eager model citing every retrieved chunk used to fail
// schema validation and surface as a hard refusal. Accept what the model
// produces and clamp in code (see clampParts).
const ChatResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    parts: z.array(PartSchema).min(1),
  }),
  z.object({
    kind: z.literal("no_match"),
    text: z.string(),
    suggestions: z.array(z.string()).optional(),
  }),
]);

const MAX_VIDEO_PARTS = 3;
const MAX_PARTS = 6;

/** Enforce the product shape (≤3 videos, ≤6 parts) WITHOUT dropping text:
 *  a >3-demos answer is told to name the overflow demos in text, and that
 *  text must survive the clamp. Excess videos are dropped in place; if the
 *  result still exceeds 6 parts, trailing parts go. */
export function clampParts(parts: Part[]): Part[] {
  let videos = 0;
  const out = parts.filter((p) => p.kind !== "video" || ++videos <= MAX_VIDEO_PARTS);
  return out.slice(0, MAX_PARTS);
}

function answerSystem(locale: string): string {
  return `You answer product questions using the retrieved demo chunks below. Be brief, accurate, and only describe what the chunks actually show.

LANGUAGE — always reply in the same language as the user's most recent message. Detect it from their words. If Spanish → Spanish, French → French, Japanese → Japanese, etc. Only fall back to "${locale}" when the message is genuinely ambiguous (e.g. one-word query in an ambiguous script).

CERTAINTY — never invent details:
- Do NOT name buttons, features, or steps that don't appear in any chunk.
- Do NOT fabricate prose around the chunks. Your text part is just a short pointer to the clip.
- The clip is the authoritative answer. Keep each text part to ONE sentence (~15 words max), paraphrasing what the chunk says.
- If the chunks only partially cover the question, answer the part you can verify and stop.

WHEN TO ANSWER vs. no_match:
- At least one chunk is on-topic (describes the thing being asked, even if not literal step-by-step) → kind="answer".
- No chunk relates → kind="no_match" with a short refusal + 1-3 suggestions drawn from chunk topics.

OUTPUT SHAPE:
- kind="answer": parts[] has 1..6 items, max 3 video parts. Each video preceded by a text intro. Never two consecutive videos. If multiple chunks answer different steps of a multi-step task, interleave text+video for each step.
- kind="no_match": short text + optional suggestions[].

STRICT FIELD RULES:
- Every video.stepId MUST appear verbatim in a chunk. Never invent stepIds.
- Each video part's startMs and endMs MUST equal the chunk's globalStartMs and globalEndMs exactly.
- Always set mp4Url to "" — the server fills it.`;
}

function renderChunks(chunks: IndexedChunk[]): string {
  return chunks.map((c, i) =>
    `--- chunk ${i + 1} ---\nstepId: ${c.stepId}\ndemoId: ${c.demoId}\nstartMs: ${c.globalStartMs}\nendMs: ${c.globalEndMs}\ntext:\n${c.text}\n`,
  ).join("\n");
}

export interface AnswerWithChunksInput {
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
}

export async function answerWithChunks(input: AnswerWithChunksInput, opts: LlmOpts): Promise<ChatResponse> {
  const google = createGoogleGenerativeAI({ apiKey: opts.apiKey });
  const historyText = input.history.length === 0
    ? "(no prior turns)"
    : input.history.map((t) => `${t.role}: ${t.content}`).join("\n");

  const userBlock = [
    "Retrieved chunks:",
    renderChunks(input.chunks),
    "",
    "Conversation history:",
    historyText,
    "",
    `User: ${input.query}`,
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: google(ANSWER_MODEL),
      schema: ChatResponseSchema,
      system: answerSystem(input.locale),
      prompt: userBlock,
      // Headroom matters: a truncated generation is unparseable JSON, which
      // surfaces as a hard "couldn't construct an answer" refusal. A full
      // 6-part answer (3 clips + intros) plus the model's reasoning tokens
      // can exceed 1k tokens with k=8 retrieved chunks.
      maxTokens: 4096,
      temperature: 0.2,
    });
    const response = object as ChatResponse;
    if (response.kind === "answer") {
      return { kind: "answer", parts: clampParts(response.parts) };
    }
    return response;
  } catch {
    // Schema mismatch or upstream error → graceful refusal
    return { kind: "no_match", text: "I couldn't construct an answer." };
  }
}
