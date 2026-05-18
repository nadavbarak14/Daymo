import type { Chunk } from "../../../src/core/index-types.js";

export const SCORE_GATE = 0.55;

export interface ScoredChunk { chunk: Chunk; score: number }

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function magnitude(a: number[]): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const denom = magnitude(a) * magnitude(b);
  if (denom === 0) return 0;
  return dot(a, b) / denom;
}

export function cosineTopK(queryEmb: number[], chunks: Chunk[], k: number): ScoredChunk[] {
  const scored = chunks.map((c) => ({ chunk: c, score: cosineSimilarity(queryEmb, c.embedding) }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k);
}

export function isBelowScoreGate(scored: ScoredChunk[]): boolean {
  if (scored.length === 0) return true;
  return scored[0].score < SCORE_GATE;
}
