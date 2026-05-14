import { cosineSimilarity } from "./cosine.js";
import { buildBm25Stats, scoreBm25 } from "../indexer/bm25.js";
import type { IndexedChunk } from "../types.js";

export interface RetrieveInput {
  query: { embedding: number[]; keywords: string[] };
  chunks: IndexedChunk[];
  k: number;
}

export interface RetrieveResult {
  chunks: IndexedChunk[];
  topCosineScore: number;
}

export function retrieve(input: RetrieveInput): RetrieveResult {
  const { query, chunks, k } = input;
  if (chunks.length === 0) return { chunks: [], topCosineScore: 0 };

  const cosineScored = chunks.map((c) => ({
    chunk: c,
    score: cosineSimilarity(query.embedding, c.embedding),
  }));
  cosineScored.sort((a, b) => b.score - a.score);
  const topCosineScore = cosineScored[0]?.score ?? 0;
  const cosineTopK = cosineScored.slice(0, k).map((s) => s.chunk);

  let bm25TopK: IndexedChunk[] = [];
  if (query.keywords.length > 0) {
    const bm25Docs = chunks.map((c) => ({ id: c.stepId, keywords: c.keywords }));
    const stats = buildBm25Stats(bm25Docs);
    const bm25Scores = scoreBm25(query.keywords, bm25Docs, stats);
    bm25Scores.sort((a, b) => b.score - a.score);
    const ids = new Set(bm25Scores.slice(0, k).filter((s) => s.score > 0).map((s) => s.id));
    bm25TopK = chunks.filter((c) => ids.has(c.stepId));
  }

  const seen = new Set<string>();
  const out: IndexedChunk[] = [];
  for (const c of cosineTopK) {
    if (seen.has(c.stepId)) continue;
    seen.add(c.stepId);
    out.push(c);
    if (out.length >= k) break;
  }
  for (const c of bm25TopK) {
    if (out.length >= k) break;
    if (seen.has(c.stepId)) continue;
    seen.add(c.stepId);
    out.push(c);
  }

  return { chunks: out, topCosineScore };
}
