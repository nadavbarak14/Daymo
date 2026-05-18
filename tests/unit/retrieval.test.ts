import { describe, it, expect } from "vitest";
import { cosineTopK, isBelowScoreGate, SCORE_GATE } from "../../apps/web/lib/retrieval.js";
import type { Chunk } from "../../src/core/index-types.js";

function chunk(stepId: string, emb: number[]): Chunk {
  return {
    stepId, demoId: "d", sceneIndex: 0, stepIndex: 0,
    globalStartMs: 0, globalEndMs: 1000,
    text: stepId, embedding: emb, keywords: [],
  };
}

describe("cosineTopK", () => {
  it("returns top-K chunks ranked by cosine similarity to query", () => {
    const chunks = [
      chunk("a", [1, 0, 0]),
      chunk("b", [0, 1, 0]),
      chunk("c", [0.9, 0.1, 0]),
    ];
    const result = cosineTopK([1, 0, 0], chunks, 2);
    expect(result.map((r) => r.chunk.stepId)).toEqual(["a", "c"]);
    expect(result[0].score).toBeCloseTo(1, 5);
    expect(result[1].score).toBeGreaterThan(result[0].score - 0.2);
  });

  it("returns empty when chunks is empty", () => {
    expect(cosineTopK([1, 0], [], 5)).toEqual([]);
  });
});

describe("isBelowScoreGate", () => {
  it("returns true when top score is below 0.55", () => {
    expect(isBelowScoreGate([{ chunk: chunk("a", []), score: 0.4 }])).toBe(true);
    expect(isBelowScoreGate([{ chunk: chunk("a", []), score: 0.6 }])).toBe(false);
  });
  it("returns true when there are no results", () => {
    expect(isBelowScoreGate([])).toBe(true);
  });
  it("uses SCORE_GATE constant 0.55", () => {
    expect(SCORE_GATE).toBe(0.55);
  });
});
