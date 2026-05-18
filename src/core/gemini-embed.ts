import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export function realGeminiEmbedder(apiKey: string): Embedder {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: "gemini-embedding-001" });
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      // Gemini embedContent is single-input today; batch via Promise.all in groups of 10.
      const CONCURRENCY = 10;
      for (let i = 0; i < texts.length; i += CONCURRENCY) {
        const batch = texts.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map((t) =>
            model.embedContent({
              content: { parts: [{ text: t }], role: "user" },
              taskType: TaskType.RETRIEVAL_DOCUMENT,
            })
          )
        );
        for (const r of results) out.push(r.embedding.values);
      }
      return out;
    },
  };
}
