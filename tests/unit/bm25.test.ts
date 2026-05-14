import { describe, it, expect } from "vitest";
import { scoreBm25, buildBm25Stats, type Bm25Doc } from "../../src/indexer/bm25.js";

describe("BM25", () => {
  const docs: Bm25Doc[] = [
    { id: "a", keywords: ["create", "project", "dialog"] },
    { id: "b", keywords: ["create", "user", "form"] },
    { id: "c", keywords: ["delete", "project"] },
  ];
  const stats = buildBm25Stats(docs);

  it("returns higher scores for documents containing more query keywords", () => {
    const scores = scoreBm25(["create", "project"], docs, stats);
    expect(scores.find(s => s.id === "a")!.score).toBeGreaterThan(scores.find(s => s.id === "b")!.score);
    expect(scores.find(s => s.id === "a")!.score).toBeGreaterThan(scores.find(s => s.id === "c")!.score);
  });

  it("returns score 0 for documents with no query keywords", () => {
    const scores = scoreBm25(["nonexistent"], docs, stats);
    for (const s of scores) expect(s.score).toBe(0);
  });

  it("returns one score entry per input document, even when score is 0", () => {
    const scores = scoreBm25(["create"], docs, stats);
    expect(scores).toHaveLength(3);
  });

  it("downweights very common terms via IDF", () => {
    const scoresCreate = scoreBm25(["create"], docs, stats);
    const scoresDialog = scoreBm25(["dialog"], docs, stats);
    const topCreate = Math.max(...scoresCreate.map(s => s.score));
    const topDialog = Math.max(...scoresDialog.map(s => s.score));
    expect(topDialog).toBeGreaterThan(topCreate);
  });
});
