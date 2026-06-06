import { describe, it, expect, afterEach } from "vitest";
import { loadIndexSource } from "../../../src/next/load-index-source.js";
import type { IndexFile } from "../../../src/types.js";

const index: IndexFile = {
  version: "v1",
  widgetId: "help",
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 2,
  videoBaseUrl: "/help",
  createdAt: "x",
  etag: "x",
  demos: [],
  chunks: [],
};

function okFetch(captured: string[]): typeof fetch {
  return (async (url: string) => {
    captured.push(String(url));
    return new Response(JSON.stringify(index), { status: 200 });
  }) as unknown as typeof fetch;
}

const REQ_URL = "https://app.example.com/api/help/chat";

afterEach(() => {
  delete process.env.HELP_BASE_URL;
});

describe("loadIndexSource", () => {
  it("returns an explicitly provided index without fetching", async () => {
    const captured: string[] = [];
    const out = await loadIndexSource({ index, fetchImpl: okFetch(captured) }, REQ_URL);
    expect(out).toBe(index);
    expect(captured).toEqual([]);
  });

  it("fetches <baseUrl>/index.json when given an explicit baseUrl", async () => {
    const captured: string[] = [];
    await loadIndexSource({ baseUrl: "https://cdn.example.com/help/v1", fetchImpl: okFetch(captured) }, REQ_URL);
    expect(captured).toEqual(["https://cdn.example.com/help/v1/index.json"]);
  });

  it("strips a trailing slash from baseUrl", async () => {
    const captured: string[] = [];
    await loadIndexSource({ baseUrl: "https://cdn.example.com/help/v1/", fetchImpl: okFetch(captured) }, REQ_URL);
    expect(captured).toEqual(["https://cdn.example.com/help/v1/index.json"]);
  });

  it("falls back to HELP_BASE_URL when no baseUrl is given", async () => {
    process.env.HELP_BASE_URL = "https://env.example.com/help";
    const captured: string[] = [];
    await loadIndexSource({ fetchImpl: okFetch(captured) }, REQ_URL);
    expect(captured).toEqual(["https://env.example.com/help/index.json"]);
  });

  it("defaults to same-origin /help relative to the request when nothing is set", async () => {
    const captured: string[] = [];
    await loadIndexSource({ fetchImpl: okFetch(captured) }, REQ_URL);
    expect(captured).toEqual(["https://app.example.com/help/index.json"]);
  });

  it("throws with the URL when the fetch is not ok", async () => {
    const failing = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(loadIndexSource({ fetchImpl: failing }, REQ_URL)).rejects.toThrow(
      /failed to load help index \(404\) from https:\/\/app\.example\.com\/help\/index\.json/,
    );
  });
});
