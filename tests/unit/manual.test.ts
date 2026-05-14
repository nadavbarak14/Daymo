import { describe, it, expect } from "vitest";
import { emitManual } from "../../src/core/manual.js";
import type { DemoAst } from "../../src/types.js";

const TTS = { provider: "edge" as const, voice: "x", rate: "+0%", music_duck: true };

function ast(partial: Partial<DemoAst> = {}): DemoAst {
  return {
    frontmatter: { title: "T", url: "u", tts: TTS, ...(partial.frontmatter ?? {}) },
    scenes: partial.scenes ?? [],
  };
}

describe("emitManual", () => {
  it("returns markdown and warnings", () => {
    const out = emitManual(ast());
    expect(typeof out.markdown).toBe("string");
    expect(Array.isArray(out.warnings)).toBe(true);
  });
});

describe("frontmatter rendering", () => {
  it("emits H1 title, italic description, and URL line", () => {
    const out = emitManual(ast({
      frontmatter: { title: "Loomly Tour", description: "A walkthrough", url: "http://localhost:8765/", tts: TTS },
    }));
    expect(out.markdown).toContain("# Loomly Tour");
    expect(out.markdown).toContain("*A walkthrough*");
    expect(out.markdown).toContain("**URL:** http://localhost:8765/");
  });

  it("omits the italic description line when description is absent", () => {
    const out = emitManual(ast({
      frontmatter: { title: "T", url: "u", tts: TTS },
    }));
    expect(out.markdown).not.toMatch(/^\*[^*]/m);
    expect(out.markdown).toContain("# T");
    expect(out.markdown).toContain("**URL:** u");
  });
});

import { slug } from "../../src/core/manual.js";

describe("slug", () => {
  it("lowercases and hyphenates words", () => {
    expect(slug("Open the new-project dialog")).toBe("open-the-new-project-dialog");
  });
  it("strips punctuation", () => {
    expect(slug("Welcome back, Alex!")).toBe("welcome-back-alex");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slug("A & B (test)")).toBe("a-b-test");
  });
  it("falls back to 'untitled' for empty or all-symbol input", () => {
    expect(slug("")).toBe("untitled");
    expect(slug("---")).toBe("untitled");
    expect(slug("!@#$")).toBe("untitled");
  });
});

import type { Scene } from "../../src/types.js";

function scene(title: string, overrides: Partial<Scene> = {}): Scene {
  return {
    sourceLine: 1,
    title,
    prose: "",
    overlays: [],
    steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }],
    ...overrides,
  };
}

describe("scene rendering", () => {
  it("emits a TOC with anchored scene links", () => {
    const out = emitManual(ast({
      scenes: [scene("Welcome back, Alex"), scene("Browse the list")],
    }));
    expect(out.markdown).toContain("## Contents");
    expect(out.markdown).toContain("1. [Welcome back, Alex](#1-welcome-back-alex)");
    expect(out.markdown).toContain("2. [Browse the list](#2-browse-the-list)");
  });

  it("emits an H2 with a matching anchor for each scene", () => {
    const out = emitManual(ast({ scenes: [scene("Welcome back, Alex")] }));
    expect(out.markdown).toContain(`<a id="1-welcome-back-alex"></a>`);
    expect(out.markdown).toContain(`## 1. Welcome back, Alex`);
  });

  it("includes a horizontal rule between the TOC and the scenes", () => {
    const out = emitManual(ast({ scenes: [scene("S")] }));
    const i = out.markdown.indexOf("## Contents");
    const j = out.markdown.indexOf("---", i);
    const k = out.markdown.indexOf("## 1.", j);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
  });
});

describe("scene standalone prose", () => {
  it("renders scene prose verbatim under the H2", () => {
    const out = emitManual(ast({
      scenes: [scene("S", { prose: "Some intro text.\n\nA second paragraph." })],
    }));
    expect(out.markdown).toContain("Some intro text.");
    expect(out.markdown).toContain("A second paragraph.");
  });

  it("does not add a prose block when prose is empty", () => {
    const withProse = emitManual(ast({ scenes: [scene("S", { prose: "Hi." })] }));
    const without = emitManual(ast({ scenes: [scene("S", { prose: "" })] }));
    expect(withProse.markdown.length).toBeGreaterThan(without.markdown.length);
    expect(without.markdown).not.toContain("Hi.");
  });
});

import type { Step } from "../../src/types.js";

function step(overrides: Partial<Step> = {}): Step {
  return {
    says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [],
    ...overrides,
  };
}

describe("step rendering", () => {
  it("emits H3 for each fx.step (preamble step is implicit, no H3)", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step(),                                       // implicit preamble
          step({ description: "Open the dialog" }),     // explicit
          step({ description: "Submit the form" }),
        ],
      })],
    }));
    expect(out.markdown).toContain("### 1.1 Open the dialog");
    expect(out.markdown).toContain("### 1.2 Submit the form");
    // The implicit preamble does NOT get its own H3.
    expect(out.markdown).not.toMatch(/^### 1\.0/m);
  });

  it("emits no H3 at all when a scene has only the implicit preamble", () => {
    const out = emitManual(ast({
      scenes: [scene("S", { steps: [step()] })],
    }));
    expect(out.markdown).not.toMatch(/^### /m);
  });
});

const span = { start: 0, end: 0, line: 1 };

describe("narration (fx.say)", () => {
  it("renders fx.say text as a prose paragraph in the step body", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({ description: "Welcome", says: [{ text: "Hello, friend.", span }] }),
        ],
      })],
    }));
    expect(out.markdown).toContain("Hello, friend.");
  });

  it("renders narration for the implicit preamble step too", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({ says: [{ text: "Preamble narration.", span }] }),
        ],
      })],
    }));
    expect(out.markdown).toContain("Preamble narration.");
  });
});

describe("banner (fx.banner)", () => {
  it("renders banner as 'On-screen:' lead-in when there is no fx.say in the step", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({ banners: [{ text: "Welcome to the tour.", span }] }),
        ],
      })],
    }));
    expect(out.markdown).toContain("**On-screen:** Welcome to the tour.");
  });

  it("drops banner when fx.say is also present in the same step (say wins)", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            says: [{ text: "Spoken narration.", span }],
            banners: [{ text: "Welcome.", span }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toContain("Spoken narration.");
    expect(out.markdown).not.toContain("**On-screen:** Welcome.");
  });
});

import { actionsInSourceOrder } from "../../src/core/manual.js";

describe("actionsInSourceOrder", () => {
  it("interleaves clicks, types, highlights, cursors by source line", () => {
    const s = step({
      clicks:     [{ selector: "#a", selectorSpan: { start: 0, end: 0, line: 30 },
                     description: "A button", descriptionSpan: { start: 0, end: 0, line: 30 } }],
      types:      [{ text: "hello", span: { start: 0, end: 0, line: 20 } }],
      highlights: [{ selector: "#h", selectorSpan: { start: 0, end: 0, line: 10 },
                     description: "Highlighted area", descriptionSpan: { start: 0, end: 0, line: 10 } }],
      cursors:    [{ selector: "#c", selectorSpan: { start: 0, end: 0, line: 40 },
                     description: "Cursor target", descriptionSpan: { start: 0, end: 0, line: 40 } }],
    });
    const rows = actionsInSourceOrder(s);
    expect(rows.map((r) => r.kind)).toEqual(["highlight", "type", "click", "cursor"]);
  });
});

describe("click action template", () => {
  it("renders 'Click **<description>**.' for fx.click with description", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            clicks: [{
              selector: "[data-testid=new]",
              selectorSpan: { start: 0, end: 0, line: 10 },
              description: "the new project button",
              descriptionSpan: { start: 0, end: 0, line: 10 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Click \*\*the new project button\*\*\./);
  });

  it("folds fx.cursorTo + fx.click on the same selector into a single click line", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            cursors: [{
              selector: "[data-testid=new]",
              selectorSpan: { start: 0, end: 0, line: 9 },
              description: "the new project button",
              descriptionSpan: { start: 0, end: 0, line: 9 },
            }],
            clicks: [{
              selector: "[data-testid=new]",
              selectorSpan: { start: 0, end: 0, line: 11 },
              description: "the new project button",
              descriptionSpan: { start: 0, end: 0, line: 11 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Click \*\*the new project button\*\*\./);
    expect(out.markdown).not.toMatch(/Look at /);
  });
});

describe("page.click without description", () => {
  it("renders fallback text and records a warning", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        sourceLine: 5,
        steps: [
          step({
            clicks: [{
              selector: "button.primary",
              selectorSpan: { start: 0, end: 0, line: 42 },
              description: "",
              descriptionSpan: { start: 0, end: 0, line: 42 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Click the target element\. \*\(no description — line 42\)\*/);
    expect(out.warnings).toEqual([
      { line: 42, detail: "click has no description (selector: button.primary)" },
    ]);
  });
});

describe("typeWithDelay template", () => {
  it("renders 'Type **\"<text>\"**.'", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            types: [{ text: "Holiday landing page", span: { start: 0, end: 0, line: 50 } }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Type \*\*"Holiday landing page"\*\*\./);
  });

  it("escapes embedded double-quotes in the typed text", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            types: [{ text: 'A "quoted" word', span: { start: 0, end: 0, line: 51 } }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toContain('Type **"A \\"quoted\\" word"**.');
  });
});

describe("highlight + cursorTo templates", () => {
  it("renders 'Notice **<description>**.' for fx.highlight", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            highlights: [{
              selector: ".stats",
              selectorSpan: { start: 0, end: 0, line: 60 },
              description: "the stats panel",
              descriptionSpan: { start: 0, end: 0, line: 60 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Notice \*\*the stats panel\*\*\./);
  });

  it("renders 'Look at **<description>**.' for a solo fx.cursorTo (no matching click in step)", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            cursors: [{
              selector: "[data-testid=row-2]",
              selectorSpan: { start: 0, end: 0, line: 70 },
              description: "the Q3 launch row",
              descriptionSpan: { start: 0, end: 0, line: 70 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Look at \*\*the Q3 launch row\*\*\./);
  });
});

describe("overlay rendering", () => {
  it("renders callout/highlight overlays with text as blockquotes after the steps", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        overlays: [
          { type: "callout", target: ".stats", text: "Three quick stats up top", duration: "2.5s" },
          { type: "highlight", target: ".x", duration: "1s" }, // no text → skipped
        ],
        steps: [step()],
      })],
    }));
    expect(out.markdown).toContain("> Three quick stats up top");
    expect(out.markdown.match(/^> /gm)?.length ?? 0).toBe(1);
  });
});
