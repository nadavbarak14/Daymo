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
