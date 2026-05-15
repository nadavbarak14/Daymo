import { generateText, generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { IndexedChunk, ChatResponse } from "../types.js";

const REWRITE_MODEL = "gemini-2.5-flash";
const ANSWER_MODEL = "gemini-2.5-flash";

export interface LlmOpts {
  apiKey: string;
}

const REWRITE_SYSTEM = `You rewrite the user's latest message into a single self-contained search query that captures their full intent given prior conversation turns. Output ONLY the query — no preamble, no quoting, no punctuation beyond what's strictly needed. Keep it <=30 tokens.`;

export interface RewriteQueryInput {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export async function rewriteQuery(input: RewriteQueryInput, opts: LlmOpts): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey: opts.apiKey });
  const historyText = input.history.map((t) => `${t.role}: ${t.content}`).join("\n");
  const userBlock = [
    historyText ? `Conversation so far:\n${historyText}\n` : "",
    `Latest message: ${input.message}`,
    "",
    "Search query:",
  ].join("\n");

  const { text } = await generateText({
    model: google(REWRITE_MODEL),
    system: REWRITE_SYSTEM,
    prompt: userBlock,
    maxTokens: 100,
    temperature: 0.0,
  });
  return text.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
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

const ChatResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    parts: z.array(PartSchema).min(1).max(6),
  }),
  z.object({
    kind: z.literal("no_match"),
    text: z.string(),
    suggestions: z.array(z.string()).optional(),
  }),
]);

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
      maxTokens: 1024,
      temperature: 0.2,
    });
    return object as ChatResponse;
  } catch {
    // Schema mismatch or upstream error → graceful refusal
    return { kind: "no_match", text: "I couldn't construct an answer." };
  }
}
