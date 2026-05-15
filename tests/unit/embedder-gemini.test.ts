import { describe, it, expect, vi } from "vitest";
import { embedBatch, embedQuery } from "../../src/indexer/embedder-gemini.js";

describe("embedBatch", () => {
  it("posts to the batchEmbedContents endpoint and returns embeddings in input order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        embeddings: [
          { values: [0.1, 0.2, 0.3] },
          { values: [0.4, 0.5, 0.6] },
        ],
      }),
    });
    const out = await embedBatch(["hello", "world"], { apiKey: "K", fetchFn: fetchMock });
    expect(out).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/batchEmbedContents/);
    expect(url).toContain("key=K");
  });

  it("throws a helpful error when the API returns non-200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "API key invalid",
      json: async () => ({}),
    });
    await expect(embedBatch(["x"], { apiKey: "K", fetchFn: fetchMock })).rejects.toThrow(/401/);
  });

  it("batches > 100 inputs into multiple requests", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const n = body.requests.length;
      return {
        ok: true,
        status: 200,
        json: async () => ({ embeddings: Array.from({ length: n }, () => ({ values: [0] })) }),
      };
    });
    const inputs = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const out = await embedBatch(inputs, { apiKey: "K", fetchFn: fetchMock });
    expect(out).toHaveLength(250);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("embedQuery", () => {
  it("posts to the single-content endpoint and returns one embedding vector", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [0.9, 0.8] } }),
    });
    const v = await embedQuery("how do I X?", { apiKey: "K", fetchFn: fetchMock });
    expect(v).toEqual([0.9, 0.8]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/:embedContent/);
  });
});
