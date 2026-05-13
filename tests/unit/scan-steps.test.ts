import { describe, it, expect } from "vitest";
import { scanStepEvents } from "../../src/tts/scan.js";

const FENCE_OFFSET = 100;
const FENCE_LINE = 10;

describe("scanStepEvents", () => {
  it("emits step/say/banner events in source order with file-absolute spans", () => {
    const code = [
      'await fx.step("first step");',
      'await fx.say("hi");',
      'await fx.banner("Step 1", { duration: 2 });',
      'await fx.step("second step");',
      'await fx.say("bye");',
    ].join("\n");
    const events = scanStepEvents(code, FENCE_OFFSET, FENCE_LINE);
    expect(events.map((e) => ({ kind: e.kind, text: e.text }))).toEqual([
      { kind: "step", text: "first step" },
      { kind: "say", text: "hi" },
      { kind: "banner", text: "Step 1" },
      { kind: "step", text: "second step" },
      { kind: "say", text: "bye" },
    ]);
    // Span start points at the opening quote of the literal, in file coordinates.
    // First "first step" literal: position 13 in code (after `await fx.step(`), +offset.
    expect(events[0].span.start).toBe(FENCE_OFFSET + code.indexOf('"first step"'));
    expect(events[0].span.end).toBe(events[0].span.start + '"first step"'.length);
    // Line numbers are 1-based, file-relative.
    expect(events[0].span.line).toBe(FENCE_LINE);
  });

  it("rejects fx.step with no argument", () => {
    const code = 'await fx.step();';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.step requires a string literal/);
  });

  it("rejects fx.step with a template literal", () => {
    const code = 'await fx.step(`hi ${x}`);';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.step requires a string literal/);
  });

  it("rejects fx.step with a variable arg", () => {
    const code = 'const t = "x"; await fx.step(t);';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.step requires a string literal/);
  });

  it("rejects fx.say with non-literal (existing behavior preserved)", () => {
    const code = 'await fx.say(`hi ${x}`);';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.say requires a string literal/);
  });

  it("ignores // comments and string contents that look like calls", () => {
    const code = [
      '// fx.step("not real");',
      'const x = "fx.say(\\"also not real\\")";',
      'await fx.step("real");',
    ].join("\n");
    const events = scanStepEvents(code, 0, 1);
    expect(events.map((e) => e.text)).toEqual(["real"]);
  });

  it("line numbers respect multi-line code", () => {
    const code = 'await fx.step("a");\nawait fx.step("b");';
    const events = scanStepEvents(code, 0, 5);
    expect(events[0].span.line).toBe(5);
    expect(events[1].span.line).toBe(6);
  });

  it("emits a 'type' event for each fx.typeWithDelay call, capturing the text arg", () => {
    const code = [
      'await fx.typeWithDelay("#name", "Holiday landing page", 22);',
      'await fx.typeWithDelay("#desc", "Festive variant");',
    ].join("\n");
    const events = scanStepEvents(code, 0, 1);
    expect(events.map((e) => ({ kind: e.kind, text: e.text }))).toEqual([
      { kind: "type", text: "Holiday landing page" },
      { kind: "type", text: "Festive variant" },
    ]);
  });

  it("emits a 'highlight' event for fx.highlight, capturing both selector and description", () => {
    const code = [
      'await fx.highlight(".titleline > a", "the title link", { duration: 2 });',
      'await fx.highlight(".subtext", "the byline row");',
    ].join("\n");
    const events = scanStepEvents(code, 0, 1);
    expect(events.map((e) => ({ kind: e.kind, text: e.text, description: e.description }))).toEqual([
      { kind: "highlight", text: ".titleline > a", description: "the title link" },
      { kind: "highlight", text: ".subtext", description: "the byline row" },
    ]);
    // descriptionSpan points at the description literal, not the selector.
    expect(events[0].descriptionSpan).toBeDefined();
    expect(events[0].descriptionSpan!.start).toBeGreaterThan(events[0].span.start);
  });

  it("emits a 'click' event for fx.click with description and for page.click without", () => {
    const code = [
      'await fx.click(".cta", "clicking the call-to-action");',
      'await page.click(".comments-link");',
    ].join("\n");
    const events = scanStepEvents(code, 0, 1);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "click", text: ".cta", description: "clicking the call-to-action" });
    expect(events[1]).toMatchObject({ kind: "click", text: ".comments-link" });
    expect(events[1].description).toBeUndefined();
  });

  it("emits a 'cursor' event for fx.cursorTo with description", () => {
    const code = 'await fx.cursorTo(".btn", "the primary button", { duration: 0.5 });';
    const events = scanStepEvents(code, 0, 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "cursor", text: ".btn", description: "the primary button" });
  });

  it("throws if fx.highlight is missing the description arg", () => {
    const code = 'await fx.highlight(".btn", 2);';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.highlight requires a description/);
  });

  it("ignores fx.typeWithDelay with a dynamic text arg (runtime handles it)", () => {
    const code = 'const t = "x"; await fx.typeWithDelay("#name", t);';
    expect(() => scanStepEvents(code, 0, 1)).not.toThrow();
    const events = scanStepEvents(code, 0, 1);
    expect(events).toEqual([]);
  });
});
