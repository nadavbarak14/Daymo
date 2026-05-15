export interface Bm25Doc {
  id: string;
  keywords: string[];
}

export interface Bm25Stats {
  avgDocLength: number;
  docFreq: Map<string, number>;
  numDocs: number;
}

export function buildBm25Stats(docs: Bm25Doc[]): Bm25Stats {
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const d of docs) {
    totalLen += d.keywords.length;
    const seen = new Set(d.keywords);
    for (const term of seen) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }
  return {
    avgDocLength: docs.length === 0 ? 0 : totalLen / docs.length,
    docFreq,
    numDocs: docs.length,
  };
}

const K1 = 1.5;
const B = 0.75;

export function scoreBm25(query: string[], docs: Bm25Doc[], stats: Bm25Stats): Array<{ id: string; score: number }> {
  if (stats.numDocs === 0) return docs.map(d => ({ id: d.id, score: 0 }));
  const out: Array<{ id: string; score: number }> = [];
  for (const d of docs) {
    let score = 0;
    const docLen = d.keywords.length;
    const docTerms = new Set(d.keywords);
    for (const term of query) {
      if (!docTerms.has(term)) continue;
      const df = stats.docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (stats.numDocs - df + 0.5) / (df + 0.5));
      const tf = 1;
      const denom = tf + K1 * (1 - B + B * (docLen / Math.max(1, stats.avgDocLength)));
      score += idf * ((tf * (K1 + 1)) / denom);
    }
    out.push({ id: d.id, score });
  }
  return out;
}
