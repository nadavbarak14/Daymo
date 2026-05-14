import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { answerWithChunks } from "../../src/chat-server/answer-llm.js";
import type { IndexedChunk } from "../../src/types.js";

const run = process.env.RUN_LLM_TESTS === "1" && process.env.ANTHROPIC_API_KEY;

const chunkA: IndexedChunk = {
  stepId: "loomly:0:1", demoId: "loomly", sceneIndex: 0, stepIndex: 1,
  globalStartMs: 12000, globalEndMs: 18000,
  text: "[Demo] Loomly Tour\n[Scene] Create projects\n[Step] Open the new-project dialog\nClick + New project to start a fresh one.",
  embedding: [], keywords: [],
};

describe.skipIf(!run)("answerWithChunks (real Sonnet)", () => {
  it("returns a structured answer for a matching question", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const out = await answerWithChunks({
      query: "How do I create a project?",
      history: [],
      chunks: [chunkA],
      locale: "en",
      client,
    });
    expect(out.kind).toBe("answer");
    if (out.kind === "answer") {
      const video = out.parts.find((p) => p.kind === "video");
      expect(video).toBeTruthy();
      if (video && video.kind === "video") {
        expect(video.stepId).toBe("loomly:0:1");
      }
    }
  }, 60_000);

  it("returns no_match for an off-topic question", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const out = await answerWithChunks({
      query: "What's the airspeed velocity of an unladen swallow?",
      history: [],
      chunks: [chunkA],
      locale: "en",
      client,
    });
    expect(out.kind).toBe("no_match");
  }, 60_000);
});
