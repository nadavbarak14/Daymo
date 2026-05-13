import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser.js";

const HEADER = `---
title: T
url: http://x
---

`;

describe("parser — steps", () => {
  it("produces a single implicit-preamble step when there's no fx.step", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await page.click("#a");',
      "```",
      "",
    ].join("\n");
    const ast = parse(src);
    expect(ast.scenes[0].steps).toHaveLength(1);
    expect(ast.scenes[0].steps[0].description).toBeUndefined();
    expect(ast.scenes[0].steps[0].says).toEqual([]);
    expect(ast.scenes[0].steps[0].banners).toEqual([]);
  });

  it("opens new steps on fx.step calls; preamble holds pre-step literals", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.say("preamble line");',
      'await fx.step("first step");',
      'await fx.say("inside first");',
      'await fx.banner("Banner A");',
      'await fx.step("second step");',
      "```",
      "",
    ].join("\n");
    const ast = parse(src);
    const steps = ast.scenes[0].steps;
    expect(steps).toHaveLength(3); // preamble + 2 explicit
    expect(steps[0].description).toBeUndefined();
    expect(steps[0].says.map((s) => s.text)).toEqual(["preamble line"]);
    expect(steps[1].description).toBe("first step");
    expect(steps[1].says.map((s) => s.text)).toEqual(["inside first"]);
    expect(steps[1].banners.map((b) => b.text)).toEqual(["Banner A"]);
    expect(steps[2].description).toBe("second step");
  });

  it("spans are file-absolute: a sliced fx.step literal round-trips", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.step("hello world");',
      "```",
      "",
    ].join("\n");
    const ast = parse(src);
    const span = ast.scenes[0].steps[1].descriptionSpan!;
    expect(src.slice(span.start, span.end)).toBe('"hello world"');
  });

  it("rejects two fx.say in the same step", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.step("only one say allowed");',
      'await fx.say("first");',
      'await fx.say("second");',
      "```",
      "",
    ].join("\n");
    expect(() => parse(src)).toThrow(/at most one fx\.say per step/);
  });

  it("rejects two fx.banner in the same step", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.step("only one banner allowed");',
      'await fx.banner("A");',
      'await fx.banner("B");',
      "```",
      "",
    ].join("\n");
    expect(() => parse(src)).toThrow(/at most one fx\.banner per step/);
  });

  it("folds fx.typeWithDelay literals into the current step's `types` (multiple allowed)", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.step("Fill the form");',
      'await fx.typeWithDelay("#name", "Holiday landing page", 22);',
      'await fx.typeWithDelay("#desc", "Festive variant");',
      "```",
      "",
    ].join("\n");
    const ast = parse(src);
    const steps = ast.scenes[0].steps;
    expect(steps[1].description).toBe("Fill the form");
    expect(steps[1].types.map((t) => t.text)).toEqual(["Holiday landing page", "Festive variant"]);
  });

  it("preamble can also hit the invariants", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.say("a");',
      'await fx.say("b");',
      "```",
      "",
    ].join("\n");
    expect(() => parse(src)).toThrow(/at most one fx\.say per step/);
  });
});
