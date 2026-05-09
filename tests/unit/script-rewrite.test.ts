import { describe, it, expect } from "vitest";
import { rewriteSceneProse } from "../../src/editor/script-rewrite.js";
import { parse } from "../../src/parser.js";

const SAMPLE = `---
title: T
url: http://x
---

# Welcome

Old prose.

\`\`\`playwright
await page.waitForSelector("h1");
\`\`\`

---

# Two

Second prose.
`;

describe("rewriteSceneProse", () => {
  it("replaces prose for the targeted scene only", () => {
    const updated = rewriteSceneProse(SAMPLE, 0, "New welcome line.");
    expect(updated).toContain("# Welcome\n\nNew welcome line.\n\n```playwright");
    expect(updated).toContain("# Two\n\nSecond prose.");
    const ast = parse(updated);
    expect(ast.scenes[0].prose).toBe("New welcome line.");
    expect(ast.scenes[1].prose).toBe("Second prose.");
  });

  it("works for the last scene with no fence after the prose", () => {
    const updated = rewriteSceneProse(SAMPLE, 1, "Replaced.");
    const ast = parse(updated);
    expect(ast.scenes[1].prose).toBe("Replaced.");
  });

  it("throws when the round-trip breaks scene count", () => {
    expect(() => rewriteSceneProse(SAMPLE, 0, "Looks fine\n\n# Sneaky scene\n")).toThrow(/scene count/i);
  });
});
