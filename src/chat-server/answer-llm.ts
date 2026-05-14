import type Anthropic from "@anthropic-ai/sdk";
import type { IndexedChunk, ChatResponse } from "../types.js";

export interface AnswerOpts {
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
  client: Anthropic;
}

const SYSTEM_TEMPLATE = (locale: string) => `You answer "how do I X?" questions about a product using ONLY the retrieved demo chunks provided below. Your output is a JSON object matching this schema:

type ChatResponse =
  | { "kind": "answer", "parts": Part[] }
  | { "kind": "no_match", "text": string, "suggestions"?: string[] };

type Part =
  | { "kind": "text", "text": string }
  | { "kind": "video", "stepId": string, "demoId": string, "startMs": number, "endMs": number, "caption": string, "mp4Url": "" };

Rules:
- Output ONLY the JSON object — no preamble, no markdown fences.
- If the retrieved chunks don't clearly answer the question, return { "kind": "no_match", "text": "<honest fallback>", "suggestions": ["...up to 3..."] }. Never use general knowledge to fill gaps.
- Every VideoPart.stepId MUST appear verbatim in a chunk below. Never invent stepIds.
- Always set "mp4Url" to "" — the server fills it in.
- Interleave parts: each video part must be preceded by a text part. Never two consecutive videos.
- Total parts <= 6. Video parts <= 3.
- Respond in this language: ${locale}. If the user's message is in another language, prefer that one.
- For text-only answers (chunks contain explanation but no specific visual moment), return a single TextPart.`;

const SCHEMA_GUIDANCE = `Return a JSON object with this exact shape. Never return prose, never return markdown.`;

function renderChunks(chunks: IndexedChunk[]): string {
  return chunks.map((c, i) => `--- chunk ${i + 1} ---\nstepId: ${c.stepId}\ndemoId: ${c.demoId}\nstartMs: ${c.globalStartMs}\nendMs: ${c.globalEndMs}\ntext:\n${c.text}\n`).join("\n");
}

function renderHistory(history: AnswerOpts["history"]): string {
  if (history.length === 0) return "(no prior turns)";
  return history.map((t) => `${t.role}: ${t.content}`).join("\n");
}

export async function answerWithChunks(opts: AnswerOpts): Promise<ChatResponse> {
  const userBlock = [
    SCHEMA_GUIDANCE,
    "",
    "Retrieved chunks:",
    renderChunks(opts.chunks),
    "",
    "Conversation history:",
    renderHistory(opts.history),
    "",
    `User: ${opts.query}`,
  ].join("\n");

  const resp = await opts.client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_TEMPLATE(opts.locale),
    messages: [{ role: "user", content: userBlock }],
  });
  const block = resp.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
  const raw = block?.text ?? "";

  try {
    const parsed = JSON.parse(raw) as ChatResponse;
    if (parsed.kind === "answer" && !Array.isArray((parsed as { parts: unknown }).parts)) {
      return { kind: "no_match", text: "I couldn't construct an answer." };
    }
    if (parsed.kind !== "answer" && parsed.kind !== "no_match") {
      return { kind: "no_match", text: "I couldn't construct an answer." };
    }
    return parsed;
  } catch {
    return { kind: "no_match", text: "I couldn't construct an answer." };
  }
}
