export function pickSuggestedQuestions(descriptions: string[]): string[] {
  const counts = new Map<string, number>();
  for (const d of descriptions) {
    if (!d || d === "(preamble)") continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const scored = Array.from(counts.entries()).map(([d, count]) => {
    const uniqueWords = new Set(d.toLowerCase().split(/\s+/).filter(Boolean)).size;
    return { d, score: uniqueWords * Math.log(1 + count) + uniqueWords * 0.01 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ d }) => phraseAsQuestion(d));
}

function phraseAsQuestion(description: string): string {
  const lower = description.charAt(0).toLowerCase() + description.slice(1);
  const trimmed = lower.replace(/[.?!]+$/, "");
  return `How do I ${trimmed}?`;
}
