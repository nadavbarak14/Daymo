import { describe, it, expect, vi } from "vitest";
import { answerWithChunks } from "../../src/chat-server/answer-llm.js";
import type { IndexedChunk, ChatResponse } from "../../src/types.js";

function chunk(stepId: string, text: string): IndexedChunk {
  const [demoId, sceneIndex, stepIndex] = stepId.split(":");
  return {
    stepId,
    demoId,
    sceneIndex: Number(sceneIndex),
    stepIndex: Number(stepIndex),
    globalStartMs: 1000,
    globalEndMs: 2000,
    text,
    embedding: [],
    keywords: [],
  };
}

describe("answerWithChunks", () => {
  it("returns the parsed JSON ChatResponse from the LLM", async () => {
    const payload: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "text", text: "Here's how:" },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "Step 1", mp4Url: "" },
      ],
    };
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify(payload) }],
        }),
      },
    };
    const out = await answerWithChunks({
      query: "how do I X?",
      history: [],
      chunks: [chunk("d:0:1", "step text")],
      locale: "en",
      client: mockClient as never,
    });
    expect(out).toEqual(payload);
  });

  it("returns no_match when the model emits invalid JSON", async () => {
    const mockClient = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "I'm sorry, not JSON." }] }) },
    };
    const out = await answerWithChunks({ query: "x", history: [], chunks: [], locale: "en", client: mockClient as never });
    expect(out.kind).toBe("no_match");
  });

  it("returns no_match when the model emits a shape that doesn't match the schema", async () => {
    const mockClient = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ kind: "answer", parts: "not an array" }) }] }) },
    };
    const out = await answerWithChunks({ query: "x", history: [], chunks: [], locale: "en", client: mockClient as never });
    expect(out.kind).toBe("no_match");
  });

  it("passes locale into the system prompt", async () => {
    const mockClient = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ kind: "no_match", text: "x" }) }] }) },
    };
    await answerWithChunks({ query: "x", history: [], chunks: [], locale: "ja", client: mockClient as never });
    const call = mockClient.messages.create.mock.calls[0][0];
    expect(call.system).toContain("ja");
  });
});
