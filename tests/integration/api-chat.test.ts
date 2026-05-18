import { describe, it, expect, vi } from "vitest";

// Mock blob + gemini before importing the route handler.
vi.mock("../../apps/web/lib/blob.js", () => ({
  getConfig: vi.fn().mockResolvedValue({ companyId: "acme", name: "Acme", locale: "en", allowedOrigins: ["https://acme.com"], suggestedQuestions: [], createdAt: "" }),
  getIndex: vi.fn().mockResolvedValue({
    schemaVersion: 1, companyId: "acme", embeddingModel: "gemini-embedding-001", embeddingDims: 768,
    createdAt: "", etag: "sha256:x",
    demos: [{ demoId: "tour", title: "T", description: "", durationMs: 5000 }],
    chunks: [{
      stepId: "tour:0:0", demoId: "tour", sceneIndex: 0, stepIndex: 0,
      globalStartMs: 0, globalEndMs: 5000, text: "Log in steps", embedding: [1, 0, 0], keywords: [],
    }],
  }),
  mp4Url: vi.fn().mockResolvedValue("https://blob/m.mp4"),
}));

vi.mock("../../apps/web/lib/gemini.js", () => ({
  realGeminiClient: () => ({
    rewriteQuery: vi.fn().mockResolvedValue("log in"),
    embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
    answer: vi.fn().mockResolvedValue({
      kind: "answer",
      parts: [
        { kind: "text", text: "Here's how to log in:" },
        { kind: "video", stepId: "tour:0:0", demoId: "tour", startMs: 0, endMs: 5000, caption: "Login", mp4Url: "https://blob/m.mp4" },
      ],
    }),
  }),
}));

vi.mock("../../apps/web/lib/rate-limit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

const { POST } = await import("../../apps/web/app/api/chat/route.js");

function makeRequest(body: any, headers: Record<string, string> = {}): any {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    nextUrl: new URL("https://x/api/chat"),
  };
}

describe("POST /api/chat", () => {
  it("returns kind=answer for a valid request", async () => {
    const res = await POST(makeRequest(
      { companyId: "acme", message: "how do I log in?", history: [] },
      { origin: "https://acme.com", host: "x" }
    ) as any);
    const data = await res.json();
    expect(data.kind).toBe("answer");
  });

  it("rejects invalid companyId with 400", async () => {
    const res = await POST(makeRequest({ companyId: "API", message: "?", history: [] }, {}) as any);
    expect(res.status).toBe(400);
  });

  it("rejects bad origin with 403", async () => {
    const res = await POST(makeRequest(
      { companyId: "acme", message: "?", history: [] },
      { origin: "https://evil.com", host: "x" }
    ) as any);
    expect(res.status).toBe(403);
  });

  it("isolates tenants: a request for companyId 'evil' cannot retrieve acme chunks", async () => {
    // getConfig mock returns null for unknown company → 404 short-circuits before any retrieval.
    const { getConfig } = await import("../../apps/web/lib/blob.js");
    (getConfig as any).mockResolvedValueOnce(null);
    const res = await POST(makeRequest(
      { companyId: "evil", message: "anything", history: [] },
      { origin: "https://acme.com", host: "x" }
    ) as any);
    expect(res.status).toBe(404);
  });
});
