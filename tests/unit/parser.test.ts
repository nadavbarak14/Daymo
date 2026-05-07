// tests/unit/parser.test.ts
import { describe, it, expect } from "vitest";
import { parse, parseDurationMs } from "../../src/parser.js";

const MINIMAL = `---
title: My demo
url: http://localhost:3000
---

# Hello world

This is the first scene.

\`\`\`playwright
await page.goto("/");
\`\`\`

\`\`\`overlay
type: callout
target: "h1"
text: "Hi"
duration: 1s
\`\`\`

---

# Second scene

Goodbye.

\`\`\`playwright
await page.click("button");
\`\`\`
`;

describe("parseDurationMs", () => {
  it("accepts plain seconds", () => {
    expect(parseDurationMs("0.5s", 999)).toBe(500);
    expect(parseDurationMs("2s", 999)).toBe(2000);
  });
  it("accepts ms suffix", () => {
    expect(parseDurationMs("500ms", 999)).toBe(500);
  });
  it("accepts plain numbers (with no unit) as seconds", () => {
    expect(parseDurationMs("0.5", 999)).toBe(500);
  });
  it("accepts bare numeric input as ms", () => {
    expect(parseDurationMs(800 as unknown as string, 999)).toBe(800);
  });
  it("returns default for undefined / null / empty", () => {
    expect(parseDurationMs(undefined, 123)).toBe(123);
    expect(parseDurationMs(null as unknown as string, 123)).toBe(123);
    expect(parseDurationMs("", 123)).toBe(123);
  });
  it("throws on multi-dot input", () => {
    expect(() => parseDurationMs("5.5.5s", 0)).toThrow(/invalid duration/);
  });
  it("throws on garbage", () => {
    expect(() => parseDurationMs("nope", 0)).toThrow(/invalid duration/);
  });
  it("throws on infinite/NaN bare numbers", () => {
    expect(() => parseDurationMs(NaN as unknown as number, 0)).toThrow(/invalid duration/);
  });
});

describe("parser", () => {
  it("extracts frontmatter", () => {
    const ast = parse(MINIMAL);
    expect(ast.frontmatter.title).toBe("My demo");
    expect(ast.frontmatter.url).toBe("http://localhost:3000");
  });

  it("extracts two scenes with titles and prose", () => {
    const ast = parse(MINIMAL);
    expect(ast.scenes).toHaveLength(2);
    expect(ast.scenes[0].title).toBe("Hello world");
    expect(ast.scenes[0].prose.trim()).toBe("This is the first scene.");
    expect(ast.scenes[1].title).toBe("Second scene");
    expect(ast.scenes[1].prose.trim()).toBe("Goodbye.");
  });

  it("extracts the playwright code block per scene", () => {
    const ast = parse(MINIMAL);
    expect(ast.scenes[0].playwrightCode?.code).toContain('await page.goto("/")');
    expect(ast.scenes[1].playwrightCode?.code).toContain('await page.click("button")');
  });

  it("extracts overlay directives parsed as YAML", () => {
    const ast = parse(MINIMAL);
    expect(ast.scenes[0].overlays).toHaveLength(1);
    expect(ast.scenes[0].overlays[0]).toMatchObject({
      type: "callout",
      target: "h1",
      text: "Hi",
      duration: "1s",
    });
    expect(ast.scenes[1].overlays).toHaveLength(0);
  });

  it("records the source line of each scene heading for error messages", () => {
    const ast = parse(MINIMAL);
    expect(ast.scenes[0].sourceLine).toBeGreaterThan(0);
    expect(ast.scenes[1].sourceLine).toBeGreaterThan(ast.scenes[0].sourceLine);
  });

  it("records the source line where the playwright block starts", () => {
    const ast = parse(MINIMAL);
    expect(ast.scenes[0].playwrightCode?.sourceLine).toBeGreaterThan(ast.scenes[0].sourceLine);
  });

  it("throws on missing frontmatter", () => {
    expect(() => parse("# just a heading\nno frontmatter\n")).toThrow(/frontmatter/i);
  });

  it("throws on a scene without a heading", () => {
    const bad = `---
title: x
url: http://localhost
---

just prose with no heading
`;
    expect(() => parse(bad)).toThrow(/heading/i);
  });
});

describe("parser v0.2 frontmatter", () => {
  it("reads defaultTransition and transitionDuration", () => {
    const ast = parse(`---
title: x
url: http://localhost
defaultTransition: dip-to-black
transitionDuration: 0.8s
---

# scene
prose
`);
    expect(ast.frontmatter.defaultTransition).toBe("dip-to-black");
    expect(ast.frontmatter.transitionDuration).toBe("0.8s");
  });

  it("reads captureMode", () => {
    const ast = parse(`---
title: x
url: http://localhost
captureMode: per-scene
---

# scene
prose
`);
    expect(ast.frontmatter.captureMode).toBe("per-scene");
  });

  it("rejects an unknown defaultTransition value", () => {
    expect(() => parse(`---
title: x
url: http://localhost
defaultTransition: spin
---

# s
p
`)).toThrow(/must be one of crossfade/);
  });

  it("rejects an unknown captureMode value", () => {
    expect(() => parse(`---
title: x
url: http://localhost
captureMode: weird
---

# s
p
`)).toThrow(/must be one of continuous, per-scene/);
  });
});

describe("parser v0.2 transition block", () => {
  it("parses a per-scene transition block", () => {
    const ast = parse(`---
title: x
url: http://localhost
---

# first

\`\`\`playwright
await page.goto("/");
\`\`\`

---

# second

\`\`\`transition
type: dip-to-black
duration: 0.8s
\`\`\`

prose
`);
    expect(ast.scenes[0].transition).toBeUndefined();
    expect(ast.scenes[1].transition).toEqual({ type: "dip-to-black", durationMs: 800 });
  });

  it("uses default duration 0.5s when not specified", () => {
    const ast = parse(`---
title: x
url: http://localhost
---

# s

\`\`\`transition
type: crossfade
\`\`\`
`);
    expect(ast.scenes[0].transition).toEqual({ type: "crossfade", durationMs: 500 });
  });

  it("rejects an unknown transition type inside a transition block", () => {
    expect(() => parse(`---
title: x
url: http://localhost
---

# first

\`\`\`transition
type: spin
\`\`\`
`)).toThrow(/unknown type/);
  });

  it("rejects a transition block with no type field", () => {
    expect(() => parse(`---
title: x
url: http://localhost
---

# s

\`\`\`transition
duration: 0.5s
\`\`\`
`)).toThrow(/type/);
  });

  it("rejects two transition blocks in one scene", () => {
    expect(() => parse(`---
title: x
url: http://localhost
---

# s

\`\`\`transition
type: crossfade
\`\`\`

\`\`\`transition
type: none
\`\`\`
`)).toThrow(/more than one transition/);
  });
});
