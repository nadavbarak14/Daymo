import { describe, it, expect } from "vitest";
import { formatReviewPrompt } from "../../src/editor/prompt.js";

const state: any = {
  demoFile: "/p/demo.demo",
  scenes: [
    {
      sourceLine: 1,
      title: "Welcome",
      prose: "Old prose.",
      overlays: [{ type: "callout", target: "[data-x]", text: "click here", duration: "2s" }],
      state: "captured",
    },
    { sourceLine: 9, title: "Two", prose: "Second.", overlays: [], state: "captured" },
  ],
};

describe("formatReviewPrompt", () => {
  it("includes only scenes referenced by drafts; quotes prose; renders overlay yaml", () => {
    const md = formatReviewPrompt(state, [
      { id: "1", sceneIndex: 0, targetKind: "caption", text: "shorten" },
      { id: "2", sceneIndex: 0, targetKind: "overlay", targetIndex: 0, text: "rewrite friendlier" },
    ]);
    expect(md).toContain("`/p/demo.demo`");
    expect(md).toContain("# Comment 1 — Scene 1 (caption)");
    expect(md).toContain("> Old prose.");
    expect(md).toContain("> shorten");
    expect(md).toContain("# Comment 2 — Scene 1 (overlay)");
    expect(md).toContain("type: callout");
    expect(md).not.toContain("# Comment 3");
    expect(md).not.toContain("Scene 2");
  });

  it("formats a step.description comment", () => {
    const state: any = {
      demoFile: "/x.demo",
      scenes: [{
        sourceLine: 1, title: "T", prose: "", overlays: [], steps: [
          { says: [], banners: [] },
          { description: "Click the button", says: [{ text: "hi", span: { start: 0, end: 1, line: 1 } }], banners: [] },
        ], state: "pending",
      }],
    };
    const out = formatReviewPrompt(state, [{
      id: "1", sceneIndex: 0, stepIndex: 1, targetKind: "step.description", text: "rename me",
    }]);
    expect(out).toContain('Step 1 — "Click the button"');
    expect(out).toContain('rename me');
  });
});
