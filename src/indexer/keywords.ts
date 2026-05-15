const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so",
  "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "by", "with", "for", "from", "as",
  "it", "its", "this", "that", "these", "those",
  "i", "you", "he", "she", "we", "they",
  "do", "does", "did", "done",
  "have", "has", "had",
  "not", "no",
]);

export function extractKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const tokens = text
    .toLowerCase()
    .split(/[\s.,;:!?()[\]{}"'`<>/\\|@#$%^&*+=~_\-—–]+/u)
    .filter(Boolean);
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}
