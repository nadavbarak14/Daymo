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
