import { describe, it, expect } from "vitest";
import { extractKeywords } from "../../src/indexer/keywords.js";

describe("extractKeywords", () => {
  it("tokenizes on whitespace and punctuation; lowercases; dedupes", () => {
    const kw = extractKeywords("Click the New-Project button. Click again.");
    expect(kw).toContain("click");
    expect(kw).toContain("new");
    expect(kw).toContain("project");
    expect(kw).toContain("button");
    expect(kw).toContain("again");
    expect(kw.filter(k => k === "click")).toHaveLength(1);
  });

  it("drops stopwords like 'the', 'a', 'an', 'and', 'or', 'is', 'are', 'to', 'of', 'in', 'on', 'with', 'for'", () => {
    const kw = extractKeywords("The cat is on the mat with a hat for the bat.");
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("a");
    expect(kw).not.toContain("is");
    expect(kw).not.toContain("on");
    expect(kw).not.toContain("with");
    expect(kw).not.toContain("for");
    expect(kw).toContain("cat");
    expect(kw).toContain("mat");
    expect(kw).toContain("hat");
    expect(kw).toContain("bat");
  });

  it("drops tokens shorter than 2 characters", () => {
    const kw = extractKeywords("I e r a b cab");
    expect(kw).not.toContain("i");
    expect(kw).not.toContain("e");
    expect(kw).toContain("cab");
  });

  it("preserves non-English tokens by tokenizing on Unicode whitespace + ASCII punctuation only", () => {
    const kw = extractKeywords("プロジェクト 作成 — pulgar abajo");
    expect(kw).toContain("プロジェクト");
    expect(kw).toContain("作成");
    expect(kw).toContain("pulgar");
    expect(kw).toContain("abajo");
  });
});
