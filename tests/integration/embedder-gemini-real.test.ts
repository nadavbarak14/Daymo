import { describe, it, expect } from "vitest";
import { embedBatch, embedQuery } from "../../src/indexer/embedder-gemini.js";

const run = process.env.RUN_EMBED_TESTS === "1" && process.env.GEMINI_API_KEY;

describe.skipIf(!run)("Gemini embedder (real API, gated by RUN_EMBED_TESTS=1)", () => {
  it("returns 768-dim vectors for batch input", async () => {
    const vecs = await embedBatch(["hello world", "goodbye world"], { apiKey: process.env.GEMINI_API_KEY! });
    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toHaveLength(768);
    expect(vecs[1]).toHaveLength(768);
  }, 30_000);

  it("returns a 768-dim vector for a query", async () => {
    const v = await embedQuery("how do I create a project?", { apiKey: process.env.GEMINI_API_KEY! });
    expect(v).toHaveLength(768);
  }, 30_000);
});
