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
