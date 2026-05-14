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
  return `You answer "how do I X?" questions about a product using the retrieved demo chunks below. Your goal is to be helpful, NOT pedantic.

CRITICAL: If the chunks describe ANYTHING about the topic the user asked about — even just showing what something looks like — you MUST answer with the relevant video segments and a brief text introduction. The user is asking because they want to SEE the feature in action; the video answers their question even if it doesn't show literal step-by-step navigation.

Examples of when to ANSWER (not no_match):
- User: "How do I see project status?" — chunks describe the project list with status flags. ANSWER: text intro + video of the project list.
- User: "What does the dashboard look like?" — chunks show the dashboard. ANSWER: text intro + video of the dashboard scene.
- User: "How do I land on the dashboard?" — chunks show what the dashboard contains. ANSWER: brief text ("Here's what the dashboard looks like once you're signed in.") + video.

Only return kind="no_match" when the chunks are clearly UNRELATED to the user's question (e.g. user asks about exporting data but no chunk mentions exports). In that case, include 1-3 helpful "suggestions" sourced from chunk descriptions.

Output schema:
- kind="answer" with parts: 1..6 items, max 3 video parts, each video part preceded by a text part, no two consecutive video parts.
- kind="no_match" with text + optional suggestions[].

Rules:
- Every video.stepId MUST appear verbatim in a chunk below. Never invent stepIds.
- For each video part, startMs and endMs MUST match the chunk's exactly.
- Always set mp4Url to "" — the server fills it in.
- Respond in the language of the user's most recent message. If ambiguous, use "${locale}".
- Each text part should be 1-2 sentences, friendly, action-oriented.`;
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
