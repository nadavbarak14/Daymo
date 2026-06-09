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
  demos: [
    { demoId: "d", title: "Create a note", description: "Notes basics", durationMs: 60000 },
    { demoId: "e", title: "Share a course", description: "Invite people", durationMs: 70000 },
  ],
  chunks: [
    { stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 100, globalEndMs: 900,
      text: "create a note", embedding: [1, 0], keywords: ["create", "note"] },
    { stepId: "e:0:1", demoId: "e", sceneIndex: 0, stepIndex: 1, globalStartMs: 0, globalEndMs: 500,
      text: "share a course", embedding: [0, 1], keywords: ["share", "course"] },
  ],
};

function deps(over: Partial<CoreDeps> = {}): CoreDeps {
  return {
    loaded: loadIndex(index, { suggestedQuestions: ["How do I create a note?"], defaultLocale: "en" }),
    embedQuery: async () => [1, 0],
    rewriteQuery: async () => ({ queries: ["create note"], catalogIntent: false }),
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
    expect(ev.rewrittenQueries).toEqual(["create note"]);
    expect(ev.matchedStepIds).toContain("d:0:1");
  });

  it("low cosine no longer short-circuits: the answer model runs with retrievalConfidence 'low'", async () => {
    const answer = vi.fn(async () => ({ kind: "answer" as const, parts: [{ kind: "text" as const, text: "catalog overview" }] }));
    const res = await answerChat(
      { message: "unrelated", history: [], requestId: "r2" },
      deps({ embedQuery: async () => [-1, 0.05], answer }),
    );
    expect(answer).toHaveBeenCalled();
    expect(answer.mock.calls[0][0].retrievalConfidence).toBe("low");
    expect(res.body.kind).toBe("answer");
  });

  it("passes the ORIGINAL message (not the rewrite) to the answer model, plus catalog + confidence", async () => {
    const answer = vi.fn(async () => ({ kind: "answer" as const, parts: [{ kind: "text" as const, text: "ok" }] }));
    await answerChat({ message: "¿cómo lo comparto?", history: [], requestId: "r3" }, deps({ answer }));
    const arg = answer.mock.calls[0][0];
    expect(arg.query).toBe("¿cómo lo comparto?");
    expect(arg.catalog.map((d: { demoId: string }) => d.demoId)).toEqual(["d", "e"]);
    expect(["low", "normal"]).toContain(arg.retrievalConfidence);
  });

  it("catalogIntent injects each demo's first chunk so every demo is citable", async () => {
    const answer = vi.fn(async () => ({ kind: "answer" as const, parts: [{ kind: "text" as const, text: "ok" }] }));
    await answerChat(
      { message: "what can I do here?", history: [], requestId: "r4" },
      deps({ rewriteQuery: async () => ({ queries: ["product overview"], catalogIntent: true }), answer }),
    );
    const stepIds = answer.mock.calls[0][0].chunks.map((c: { stepId: string }) => c.stepId);
    expect(stepIds).toContain("d:0:1");
    expect(stepIds).toContain("e:0:1");
  });

  it("unions retrieval across rewrite queries and the raw message without duplicates", async () => {
    const embedQuery = vi.fn(async (text: string) => (text.includes("share") ? [0, 1] : [1, 0]));
    const answer = vi.fn(async () => ({ kind: "answer" as const, parts: [{ kind: "text" as const, text: "ok" }] }));
    await answerChat(
      { message: "create and share", history: [], requestId: "r5" },
      deps({ embedQuery, rewriteQuery: async () => ({ queries: ["create note", "share course"], catalogIntent: false }), answer }),
    );
    const stepIds = answer.mock.calls[0][0].chunks.map((c: { stepId: string }) => c.stepId);
    expect(new Set(stepIds).size).toBe(stepIds.length);
    expect(stepIds).toContain("d:0:1");
    expect(stepIds).toContain("e:0:1");
  });

  it("replaces the empty-text no_match marker with the configured no-match", async () => {
    const res = await answerChat(
      { message: "x", history: [], requestId: "r6" },
      deps({ answer: async () => ({ kind: "no_match", text: "" }) }),
    );
    if (res.body.kind !== "no_match") throw new Error("expected no_match");
    expect(res.body.text).toBe("I don't have that in the demos. Try one of these:");
    expect(res.body.suggestions).toEqual(["How do I create a note?"]);
  });

  it("downgrades to no_match when the LLM returns an unknown stepId", async () => {
    const res = await answerChat(
      { message: "create", history: [], requestId: "r7" },
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

  it("empty index AND empty catalog → canned no_match without calling the LLM", async () => {
    const empty: IndexFile = { ...index, demos: [], chunks: [] };
    const answer = vi.fn();
    const res = await answerChat(
      { message: "anything", history: [], requestId: "r8" },
      deps({ loaded: loadIndex(empty, { suggestedQuestions: ["Try this?"], defaultLocale: "en" }), answer }),
    );
    expect(answer).not.toHaveBeenCalled();
    expect(res.body.kind).toBe("no_match");
  });

  it("caps history to the last 2 turns before rewrite", async () => {
    const rewriteQuery = vi.fn(async () => ({ queries: ["create note"], catalogIntent: false }));
    const history = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
      { role: "user" as const, content: "c" },
      { role: "assistant" as const, content: "d" },
    ];
    await answerChat({ message: "more", history, requestId: "r9" }, deps({ rewriteQuery }));
    expect(rewriteQuery.mock.calls[0][0].history).toHaveLength(2);
  });
});
