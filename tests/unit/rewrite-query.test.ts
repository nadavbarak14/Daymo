import { describe, it, expect, vi, beforeEach } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
  generateText: vi.fn(),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => "model-stub",
}));

import { rewriteQuery } from "../../src/chat-server/llm.js";

const input = {
  message: "how do I share it?",
  history: [{ role: "user" as const, content: "how do I create a course" }],
  catalog: [{ demoId: "share", title: "Share a course", description: "Invite students", durationMs: 60000 }],
};

describe("rewriteQuery", () => {
  beforeEach(() => { generateObject.mockReset(); });

  it("returns trimmed queries and the catalogIntent flag", async () => {
    generateObject.mockResolvedValue({ object: { queries: ['  "share a course"  '], catalogIntent: false } });
    const out = await rewriteQuery(input, { apiKey: "k" });
    expect(out).toEqual({ queries: ["share a course"], catalogIntent: false });
  });

  it("includes the catalog in the system prompt", async () => {
    generateObject.mockResolvedValue({ object: { queries: ["x"], catalogIntent: true } });
    await rewriteQuery(input, { apiKey: "k" });
    const call = generateObject.mock.calls[0][0] as { system: string };
    expect(call.system).toContain("Share a course");
  });

  it("fails open to the raw message on LLM error", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    const out = await rewriteQuery(input, { apiKey: "k" });
    expect(out).toEqual({ queries: ["how do I share it?"], catalogIntent: false });
  });

  it("fails open when the model returns only empty strings", async () => {
    generateObject.mockResolvedValue({ object: { queries: ['""'], catalogIntent: false } });
    const out = await rewriteQuery(input, { apiKey: "k" });
    expect(out.queries).toEqual(["how do I share it?"]);
  });
});
