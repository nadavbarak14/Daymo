import { describe, it, expect } from "vitest";
import { pickSuggestedQuestions } from "../../src/indexer/suggested-questions.js";

describe("pickSuggestedQuestions", () => {
  it("returns up to 3 questions, derived from fx.step descriptions", () => {
    const out = pickSuggestedQuestions([
      "Open the new-project dialog",
      "Name the project",
      "Submit the form",
      "Archive the project",
    ]);
    expect(out).toHaveLength(3);
    for (const q of out) expect(q.startsWith("How do I ")).toBe(true);
    expect(out[0]).toMatch(/open.*new.project.*dialog/i);
  });

  it("returns fewer than 3 when input has fewer steps", () => {
    expect(pickSuggestedQuestions(["Do the thing"]).length).toBe(1);
    expect(pickSuggestedQuestions([]).length).toBe(0);
  });

  it("dedupes identical descriptions", () => {
    const out = pickSuggestedQuestions([
      "Open the dialog", "Open the dialog", "Submit", "Cancel",
    ]);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });

  it("skips the implicit '(preamble)' marker", () => {
    const out = pickSuggestedQuestions([
      "(preamble)", "Open the dialog", "(preamble)", "Submit",
    ]);
    for (const q of out) {
      expect(q).not.toMatch(/preamble/i);
    }
  });
});
