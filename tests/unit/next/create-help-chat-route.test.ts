import { describe, it, expect } from "vitest";
import { createHelpChatRoute } from "../../../src/next/create-help-chat-route.js";
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

function req(body: unknown): Request {
  return new Request("https://app.example.com/api/help/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(body),
  });
}

describe("createHelpChatRoute", () => {
  it("throws when apiKey is missing", () => {
    expect(() => createHelpChatRoute({ apiKey: "", index })).toThrow(/apiKey/);
  });

  it("builds a working handler from an explicit index without fetching", async () => {
    const captured: string[] = [];
    const fetchImpl = (async (url: string) => {
      captured.push(String(url));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const POST = createHelpChatRoute({ apiKey: "k", index, fetchImpl });
    // An invalid body is rejected before any LLM/embedding call, so this
    // exercises construction + index resolution without touching Gemini.
    const res = await POST(req({ message: 123 }));
    expect(res.status).toBe(400);
    expect(captured).toEqual([]);
  });

  it("returns 503 when the index cannot be loaded, and retries on the next call", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    const POST = createHelpChatRoute({ apiKey: "k", baseUrl: "https://cdn/help", fetchImpl });

    const res1 = await POST(req({ message: "hi", history: [] }));
    expect(res1.status).toBe(503);
    expect(calls).toBe(1);

    // A transient cold-start failure must not be cached — the next request retries.
    const res2 = await POST(req({ message: "hi", history: [] }));
    expect(res2.status).toBe(503);
    expect(calls).toBe(2);
  });
});
