import { describe, it, expect, vi } from "vitest";
import { runChatPipeline } from "../../apps/web/lib/chat-pipeline.js";
import type { IndexJson } from "../../src/core/index-types.js";

function fakeIndex(): IndexJson {
  return {
    schemaVersion: 1, companyId: "acme",
    embeddingModel: "gemini-embedding-001", embeddingDims: 768,
    createdAt: "2026-05-18T00:00:00Z", etag: "sha256:x",
    demos: [{ demoId: "tour", title: "Tour", description: "", durationMs: 5000 }],
    chunks: [{
      stepId: "tour:0:0", demoId: "tour", sceneIndex: 0, stepIndex: 0,
      globalStartMs: 0, globalEndMs: 5000, text: "How to log in",
      embedding: [1, 0, 0], keywords: ["log", "in"],
    }],
  };
}

describe("runChatPipeline", () => {
  it("returns answer when score gate passes and LLM returns valid stepId", async () => {
    const client = {
      rewriteQuery: vi.fn().mockResolvedValue("how do i log in"),
      embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
      answer: vi.fn().mockResolvedValue({
        kind: "answer",
        parts: [
          { kind: "text", text: "Here's how:" },
          { kind: "video", stepId: "tour:0:0", demoId: "tour", startMs: 0, endMs: 5000, caption: "Login", mp4Url: "https://x/m.mp4" },
        ],
      }),
    };
    const result = await runChatPipeline({
      request: { companyId: "acme", message: "how do i log in?", history: [], locale: "en" },
      index: fakeIndex(),
      mp4UrlFor: async () => "https://x/m.mp4",
      gemini: client,
    });
    expect(result.kind).toBe("answer");
    expect(client.rewriteQuery).toHaveBeenCalled();
  });

  it("returns no_match when top score is below the gate", async () => {
    const client = {
      rewriteQuery: vi.fn().mockResolvedValue("unrelated"),
      embedQuery: vi.fn().mockResolvedValue([0, 1, 0]),  // orthogonal to chunk emb
      answer: vi.fn(),
    };
    const result = await runChatPipeline({
      request: { companyId: "acme", message: "where is the moon?", history: [], locale: "en" },
      index: fakeIndex(),
      mp4UrlFor: async () => "https://x/m.mp4",
      gemini: client,
    });
    expect(result.kind).toBe("no_match");
    expect(client.answer).not.toHaveBeenCalled();
  });

  it("downgrades to no_match when LLM returns an invalid stepId", async () => {
    const client = {
      rewriteQuery: vi.fn().mockResolvedValue("how"),
      embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
      answer: vi.fn().mockResolvedValue({
        kind: "answer",
        parts: [
          { kind: "text", text: "Here:" },
          { kind: "video", stepId: "tour:0:99", demoId: "tour", startMs: 0, endMs: 5000, caption: "", mp4Url: "https://x/m.mp4" },
        ],
      }),
    };
    const result = await runChatPipeline({
      request: { companyId: "acme", message: "how?", history: [], locale: "en" },
      index: fakeIndex(),
      mp4UrlFor: async () => "https://x/m.mp4",
      gemini: client,
    });
    expect(result.kind).toBe("no_match");
  });

  it("downgrades to no_match when LLM returns more than 3 video parts", async () => {
    const v = (i: number) => ({ kind: "video" as const, stepId: "tour:0:0", demoId: "tour", startMs: 0, endMs: 1, caption: "", mp4Url: "https://x/m.mp4" });
    const client = {
      rewriteQuery: vi.fn().mockResolvedValue("how"),
      embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
      answer: vi.fn().mockResolvedValue({
        kind: "answer",
        parts: [
          { kind: "text" as const, text: "1" }, v(1),
          { kind: "text" as const, text: "2" }, v(2),
          { kind: "text" as const, text: "3" }, v(3),
          { kind: "text" as const, text: "4" }, v(4),
        ],
      }),
    };
    const result = await runChatPipeline({
      request: { companyId: "acme", message: "how?", history: [], locale: "en" },
      index: fakeIndex(),
      mp4UrlFor: async () => "https://x/m.mp4",
      gemini: client,
    });
    expect(result.kind).toBe("no_match");
  });
});
