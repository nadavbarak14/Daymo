import { describe, it, expect, vi } from "vitest";
import { embedQuery, embedBatch } from "../../src/indexer/embedder-gemini.js";

describe("embedder model is configurable", () => {
  it("uses the model id passed in opts in the query request URL", async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ embedding: { values: [0.1, 0.2] } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await embedQuery("hello", { apiKey: "k", model: "text-embedding-xyz", fetchFn });
    const calledUrl = String(fetchFn.mock.calls[0][0]);
    expect(calledUrl).toContain("text-embedding-xyz");
  });

  it("defaults to gemini-embedding-001 when no model is given", async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ embeddings: [{ values: [0.1] }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await embedBatch(["x"], { apiKey: "k", fetchFn });
    expect(String(fetchFn.mock.calls[0][0])).toContain("gemini-embedding-001");
  });
});
