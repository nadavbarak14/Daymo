import { GoogleGenerativeAI, SchemaType, TaskType } from "@google/generative-ai";
import type { ChatHistoryTurn, ChatResponse } from "../../../src/core/index-types.js";

export interface GeminiClient {
  rewriteQuery(message: string, history: ChatHistoryTurn[]): Promise<string>;
  embedQuery(text: string): Promise<number[]>;
  answer(args: {
    message: string;
    history: ChatHistoryTurn[];
    locale: string;
    chunks: Array<{ stepId: string; demoId: string; text: string; caption: string; mp4Url: string; startMs: number; endMs: number }>;
  }): Promise<ChatResponse>;
}

export function realGeminiClient(apiKey: string): GeminiClient {
  const client = new GoogleGenerativeAI(apiKey);
  const flash = client.getGenerativeModel({ model: "gemini-2.5-flash" });
  const embed = client.getGenerativeModel({ model: "gemini-embedding-001" });

  return {
    async rewriteQuery(message, history) {
      const historyText = history.map((h) => `${h.role}: ${h.content}`).join("\n");
      const prompt =
        `You rewrite the user's latest message into a single self-contained search query ` +
        `that captures their full intent given prior conversation turns. Output ONLY the ` +
        `query, no preamble, no quoting.\n\nConversation:\n${historyText}\n\n` +
        `Latest message: ${message}\n\nSearch query:`;
      const res = await flash.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
      return res.response.text().trim();
    },
    async embedQuery(text) {
      const res = await embed.embedContent({
        content: { parts: [{ text }], role: "user" },
        taskType: TaskType.RETRIEVAL_QUERY,
      });
      return res.embedding.values;
    },
    async answer({ message, history, locale, chunks }) {
      const chunksText = chunks.map((c, i) =>
        `Chunk ${i + 1} (stepId=${c.stepId}, demoId=${c.demoId}, startMs=${c.startMs}, endMs=${c.endMs}, mp4Url=${c.mp4Url}):\n${c.text}`
      ).join("\n\n");
      const historyText = history.map((h) => `${h.role}: ${h.content}`).join("\n");

      const system =
        `You answer "how do I X?" questions about a product using ONLY the retrieved demo chunks. ` +
        `Output a JSON object matching the ChatResponse schema.\n\nRules:\n` +
        `- If chunks do not clearly answer, return kind="no_match". Do not invent stepIds.\n` +
        `- Every VideoPart.stepId must appear verbatim in a chunk.\n` +
        `- Interleave text and video parts; every video preceded by an introducing text part. No two consecutive video parts.\n` +
        `- Total parts ≤ 6, video parts ≤ 3.\n` +
        `- Respond in the language of the user's most recent message. If ambiguous, use ${locale}.\n` +
        `- For text-only answers (no specific visual moment), return a single TextPart.`;

      const userPrompt =
        `Retrieved chunks:\n\n${chunksText}\n\nConversation history:\n${historyText}\n\nUser: ${message}`;

      const schema = chatResponseSchema(chunks.map((c) => c.stepId));

      const res = await flash.generateContent({
        contents: [{ role: "user", parts: [{ text: `${system}\n\n${userPrompt}` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
        } as any,
      });

      return JSON.parse(res.response.text()) as ChatResponse;
    },
  };
}

function chatResponseSchema(allowedStepIds: string[]) {
  // Build a Gemini responseSchema enforcing the ChatResponse shape.
  // Note: Gemini's schema dialect supports type/properties/required/items;
  // oneOf is supported via nullable variants. We enforce shape, and rely on
  // server-side validation for stepId-membership and count limits.
  // allowedStepIds is reserved for a future schema-tightening pass.
  void allowedStepIds;
  return {
    type: SchemaType.OBJECT,
    properties: {
      kind: { type: SchemaType.STRING, enum: ["answer", "no_match"] },
      text: { type: SchemaType.STRING },           // present on no_match
      suggestions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      parts: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            kind: { type: SchemaType.STRING, enum: ["text", "video"] },
            text: { type: SchemaType.STRING },
            stepId: { type: SchemaType.STRING },
            demoId: { type: SchemaType.STRING },
            startMs: { type: SchemaType.NUMBER },
            endMs: { type: SchemaType.NUMBER },
            caption: { type: SchemaType.STRING },
            mp4Url: { type: SchemaType.STRING },
          },
          required: ["kind"],
        },
      },
    },
    required: ["kind"],
  } as const;
}
