import { describe, it, expect, vi, beforeEach } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: () => () => "model-stub" }));

import { answerWithChunks } from "../../src/chat-server/llm.js";

const base = {
  query: "¿cómo creo un curso?",
  history: [],
  chunks: [{
    stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1,
    globalStartMs: 100, globalEndMs: 900, text: "create a course",
    embedding: [], keywords: [],
  }],
  locale: "en",
  catalog: [{ demoId: "d", title: "Create a course", description: "From the dashboard", durationMs: 79000 }],
  retrievalConfidence: "normal" as const,
};

describe("answerWithChunks", () => {
  beforeEach(() => { generateObject.mockReset(); });

  it("sends the catalog and confidence signal in the prompt, and the ORIGINAL message as the user line", async () => {
    generateObject.mockResolvedValue({ object: { kind: "answer", parts: [{ kind: "text", text: "ok" }] } });
    await answerWithChunks(base, { apiKey: "k" });
    const call = generateObject.mock.calls[0][0] as { system: string; prompt: string };
    expect(call.system).toContain("SHOWING BEATS TELLING");
    expect(call.prompt).toContain("Create a course");           // catalog
    expect(call.prompt).toContain("Retrieval confidence: normal");
    expect(call.prompt).toContain("¿cómo creo un curso?");      // original message, not a rewrite
  });

  it("clamps answer parts", async () => {
    const v = (n: number) => ({ kind: "video", stepId: `d:0:${n}`, demoId: "d", startMs: 0, endMs: 1, caption: "", mp4Url: "" });
    generateObject.mockResolvedValue({ object: { kind: "answer", parts: [v(1), v(2), v(3), v(4), { kind: "text", text: "tail" }] } });
    const out = await answerWithChunks(base, { apiKey: "k" });
    if (out.kind !== "answer") throw new Error("expected answer");
    expect(out.parts.filter((p) => p.kind === "video")).toHaveLength(3);
    expect(out.parts.at(-1)).toEqual({ kind: "text", text: "tail" });
  });

  it("returns the empty-text no_match marker on LLM failure", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    const out = await answerWithChunks(base, { apiKey: "k" });
    expect(out).toEqual({ kind: "no_match", text: "" });
  });
});
