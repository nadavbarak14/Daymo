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
  return `You answer product questions using the demo library and the retrieved demo chunks below.

Showing beats telling — your strong default is to attach video:
- A video part means "open this demo, cued to this step" — the user gets the WHOLE demo, scrubbable, with the referenced steps highlighted. It is NOT a short clip.
- When a demo covers what the user asked, attach it cued to the relevant step instead of describing UI in words ("press the button at the top" is worse than showing it).
- You decide per question. Reference multiple steps of one demo (one video part per step — the UI collapses them into one card) when the answer spans steps; reference up to 3 different demos when the answer genuinely spans demos, with text bridging them.
- If more than 3 demos are relevant, attach the 3 most relevant and name the others in a text part BEFORE the last video part.
- Text-only answers are for conceptual or catalog-level questions where no single demo moment helps.

CAPTIONS — each video part's caption is one short sentence (~15 words) saying what that step shows; it renders as a sub-line on the demo card.

GROUNDING — never invent:
- Capability claims must be supported by a demo title/description in the library or by a retrieved chunk. If unsupported, say you're not sure and point to the nearest covered demo. A confident wrong "yes it supports X" is the worst possible answer.
- Do NOT name buttons, features, or steps that don't appear in any chunk.
- When "Retrieval confidence" is low, prefer catalog-level answers ("here's what I can show you…") or no_match — do not stretch weak chunks into a specific answer.

CATALOG QUESTIONS — for "what can I do here?" / "what are my options?", answer with a short text overview of the library and attach 1-3 representative demos as video parts (their first steps are in the chunks).

LANGUAGE — always reply in the language of the user's most recent message. Detect it from their words. Only fall back to "${locale}" when genuinely ambiguous.

WHEN TO ANSWER vs. no_match:
- A chunk or catalog entry is on-topic → kind="answer".
- Nothing relates → kind="no_match": name 2-3 topics the library DOES cover, plus suggestions[] with the nearest askable questions. Never a bare "rephrase that".

OUTPUT SHAPE:
- kind="answer": parts[] has 1..6 items, max 3 video parts. Multiple video parts may cite the same demo (different steps).
- kind="no_match": helpful text + suggestions[].

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
  /** The user's ORIGINAL message (not a rewrite) — language detection depends on it. */
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
  catalog: IndexedDemo[];
  retrievalConfidence: "low" | "normal";
}

export async function answerWithChunks(input: AnswerWithChunksInput, opts: LlmOpts): Promise<ChatResponse> {
  const google = createGoogleGenerativeAI({ apiKey: opts.apiKey });
  const historyText = input.history.length === 0
    ? "(no prior turns)"
    : input.history.map((t) => `${t.role}: ${t.content}`).join("\n");

  const userBlock = [
    "Demo library:",
    renderCatalog(input.catalog),
    "",
    `Retrieval confidence: ${input.retrievalConfidence}`,
    "",
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
    // Hard LLM failure (schema mismatch / upstream error). Empty text is a
    // marker — answer-chat/handleChat substitute their configured no-match.
    return { kind: "no_match", text: "" };
  }
}
