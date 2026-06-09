import { describe, it, expect } from "vitest";
import { createChatRoute, type CreateChatRouteOpts } from "../../../src/next/create-chat-route.js";
import type { IndexFile } from "../../../src/types.js";

const index: IndexFile = {
  version: "v1",
  widgetId: "help",
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 2,
  videoBaseUrl: "https://cdn/help/v1",
  createdAt: "x",
  etag: "x",
  demos: [],
  chunks: [
    {
      stepId: "d:0:1",
      demoId: "d",
      sceneIndex: 0,
      stepIndex: 1,
      globalStartMs: 0,
      globalEndMs: 9,
      text: "create note",
      embedding: [1, 0],
      keywords: ["create"],
    },
  ],
};

function baseOpts(over: Partial<CreateChatRouteOpts> = {}): CreateChatRouteOpts {
  return {
    index,
    embeddingModelId: "gemini-embedding-001",
    suggestedQuestions: ["How do I create a note?"],
    defaultLocale: "en",
    embedQuery: async () => [0, 1],
    rewriteQuery: async () => ({ queries: ["create note"], catalogIntent: false }),
    answer: async () => ({ kind: "no_match", text: "no" }),
    rateLimitPerMinute: 2,
    ...over,
  };
}

function req(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("https://app/api/help/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("createChatRoute", () => {
  it("throws at construction on embedding-model mismatch", () => {
    expect(() => createChatRoute(baseOpts({ embeddingModelId: "other" }))).toThrow(/embedding model mismatch/);
  });

  it("returns 200 ChatResponse for a valid request", async () => {
    const POST = createChatRoute(baseOpts());
    const res = await POST(req({ message: "create", history: [] }));
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe("no_match");
  });

  it("returns 400 on invalid body", async () => {
    const POST = createChatRoute(baseOpts());
    const res = await POST(
      new Request("https://app", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rate-limits by x-forwarded-for IP (429 + Retry-After)", async () => {
    const POST = createChatRoute(baseOpts({ rateLimitPerMinute: 1 }));
    await POST(req({ message: "a", history: [] }, "9.9.9.9"));
    const res = await POST(req({ message: "b", history: [] }, "9.9.9.9"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
