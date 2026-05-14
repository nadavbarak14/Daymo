import { describe, it, expect } from "vitest";
import { retrieve } from "../../src/chat-server/retrieve.js";
import type { IndexedChunk } from "../../src/types.js";

function chunk(stepId: string, embedding: number[], keywords: string[]): IndexedChunk {
  return {
    stepId,
    demoId: stepId.split(":")[0],
    sceneIndex: 0,
    stepIndex: 0,
    globalStartMs: 0,
    globalEndMs: 1000,
    text: stepId,
    embedding,
    keywords,
  };
}

describe("retrieve", () => {
  const chunks: IndexedChunk[] = [
    chunk("d:0:1", [1, 0, 0], ["create", "project"]),
    chunk("d:0:2", [0, 1, 0], ["delete", "project"]),
    chunk("d:0:3", [0, 0, 1], ["invite", "team"]),
    chunk("d:0:4", [0.7, 0.7, 0], ["create", "team"]),
  ];

  it("returns top-K by cosine similarity when keywords overlap is tied", () => {
    const result = retrieve({
      query: { embedding: [1, 0, 0], keywords: [] },
      chunks, k: 2,
    });
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].stepId).toBe("d:0:1");
    expect(result.topCosineScore).toBeCloseTo(1, 6);
  });

  it("union of top-K cosine and top-K BM25 (deduped), final list <= K", () => {
    const result = retrieve({
      query: { embedding: [1, 0, 0], keywords: ["team"] },
      chunks, k: 3,
    });
    expect(result.chunks.map(c => c.stepId)).toContain("d:0:1");
    expect(result.chunks.map(c => c.stepId).filter(id => ["d:0:3", "d:0:4"].includes(id)).length).toBeGreaterThan(0);
    expect(result.chunks.length).toBeLessThanOrEqual(3);
  });

  it("topCosineScore is the highest cosine across all chunks (used as Layer-1 score gate)", () => {
    const result = retrieve({
      query: { embedding: [0.7, 0.7, 0], keywords: [] },
      chunks, k: 1,
    });
    expect(result.topCosineScore).toBeCloseTo(1, 6);
  });

  it("returns empty array when index has no chunks", () => {
    const result = retrieve({
      query: { embedding: [1, 0, 0], keywords: ["x"] },
      chunks: [], k: 5,
    });
    expect(result.chunks).toEqual([]);
    expect(result.topCosineScore).toBe(0);
  });
});
