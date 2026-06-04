import { describe, it, expect, vi } from "vitest";
import { answerChat } from "../../../src/chat-core/answer-chat.js";
import { loadIndex } from "../../../src/chat-core/load-index.js";
import type { IndexFile } from "../../../src/types.js";
import type { CoreDeps, HelpChatEvent } from "../../../src/chat-core/types.js";

const index: IndexFile = {
  version: "v1",
  widgetId: "help",
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 2,
  videoBaseUrl: "https://cdn/help/v1",
  createdAt: "2026-06-04T00:00:00Z",
  etag: "sha256:x",
  demos: [],
  chunks: [
    {
      stepId: "d:0:1",
      demoId: "d",
      sceneIndex: 0,
      stepIndex: 1,
      globalStartMs: 100,
      globalEndMs: 900,
      text: "create a note",
      embedding: [1, 0],
      keywords: ["create", "note"],
    },
  ],
};

function deps(over: Partial<CoreDeps> = {}): CoreDeps {
  return {
    loaded: loadIndex(index, { suggestedQuestions: ["How do I create a note?"], defaultLocale: "en" }),
    embedQuery: async () => [1, 0], // identical to the chunk → high cosine
    rewriteQuery: async () => "create note",
    answer: async () => ({
      kind: "answer",
      parts: [
        { kind: "text", text: "Here:" },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 100, endMs: 900, caption: "create", mp4Url: "" },
      ],
    }),
    ...over,
  };
}

describe("answerChat", () => {
  it("returns an answer and fills mp4Url from videoBaseUrl", async () => {
    const onEvent = vi.fn();
    const res = await answerChat({ message: "how do I create a note", history: [], requestId: "r1" }, deps({ onEvent }));
    expect(res.status).toBe(200);
    if (res.body.kind !== "answer") throw new Error("expected answer");
    const video = res.body.parts.find((p) => p.kind === "video");
    expect(video && "mp4Url" in video && video.mp4Url).toBe("https://cdn/help/v1/d/output.mp4");
    const ev = onEvent.mock.calls[0][0] as HelpChatEvent;
    expect(ev.outcome).toBe("answered");
    expect(ev.matchedStepIds).toContain("d:0:1");
  });

  it("returns no_match (with suggestions) when top cosine is below threshold", async () => {
    const res = await answerChat(
      { message: "unrelated", history: [], requestId: "r2" },
      deps({ embedQuery: async () => [0, 1] }), // orthogonal → low cosine
    );
    expect(res.body.kind).toBe("no_match");
    if (res.body.kind === "no_match") expect(res.body.suggestions).toEqual(["How do I create a note?"]);
  });

  it("downgrades to no_match when the LLM returns an unknown stepId", async () => {
    const res = await answerChat(
      { message: "create", history: [], requestId: "r3" },
      deps({
        answer: async () => ({
          kind: "answer",
          parts: [
            { kind: "text", text: "see" },
            { kind: "video", stepId: "does-not-exist", demoId: "d", startMs: 0, endMs: 1, caption: "x", mp4Url: "" },
          ],
        }),
      }),
    );
    expect(res.body.kind).toBe("no_match");
  });

  it("caps history to the last 2 turns before rewrite", async () => {
    const rewriteQuery = vi.fn(async () => "create note");
    const history = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
      { role: "user" as const, content: "c" },
      { role: "assistant" as const, content: "d" },
    ];
    await answerChat({ message: "more", history, requestId: "r4" }, deps({ rewriteQuery }));
    expect(rewriteQuery.mock.calls[0][0].history).toHaveLength(2);
  });
});
