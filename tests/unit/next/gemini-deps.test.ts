import { describe, it, expect } from "vitest";
import { createGeminiChatDeps } from "../../../src/next/gemini-deps.js";
import { DEFAULT_EMBEDDING_MODEL } from "../../../src/indexer/embedder-gemini.js";

describe("createGeminiChatDeps", () => {
  it("returns the four fields createChatRoute needs", () => {
    const deps = createGeminiChatDeps({ apiKey: "k" });
    expect(typeof deps.embedQuery).toBe("function");
    expect(typeof deps.rewriteQuery).toBe("function");
    expect(typeof deps.answer).toBe("function");
    expect(deps.embeddingModelId).toBe(DEFAULT_EMBEDDING_MODEL);
  });

  it("honours a custom embedding model id", () => {
    const deps = createGeminiChatDeps({ apiKey: "k", embeddingModelId: "text-embedding-004" });
    expect(deps.embeddingModelId).toBe("text-embedding-004");
  });

  it("throws when apiKey is missing", () => {
    expect(() => createGeminiChatDeps({ apiKey: "" })).toThrow(/apiKey/);
  });
});
