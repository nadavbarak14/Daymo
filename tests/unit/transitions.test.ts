// tests/unit/transitions.test.ts
import { describe, it, expect } from "vitest";
import { buildTransitionFilter } from "../../src/transitions.js";

describe("buildTransitionFilter", () => {
  it("crossfade emits xfade=transition=fade with correct duration and offset", () => {
    const r = buildTransitionFilter({
      inLabelA: "[a]", inLabelB: "[b]",
      clipADurationMs: 5000,
      transition: { type: "crossfade", durationMs: 500 },
      outLabel: "[ab]",
    });
    expect(r.filter).toContain("xfade=transition=fade");
    expect(r.filter).toMatch(/duration=0\.500/);
    expect(r.filter).toMatch(/offset=4\.500/);     // 5.0 - 0.5
    expect(r.filter.endsWith("[ab]")).toBe(true);
  });

  it("dip-to-black emits xfade=transition=fadeblack", () => {
    const r = buildTransitionFilter({
      inLabelA: "[a]", inLabelB: "[b]",
      clipADurationMs: 4000,
      transition: { type: "dip-to-black", durationMs: 800 },
      outLabel: "[ab]",
    });
    expect(r.filter).toContain("xfade=transition=fadeblack");
    expect(r.filter).toMatch(/duration=0\.800/);
    expect(r.filter).toMatch(/offset=3\.200/);
  });

  it("slide-left emits xfade=transition=slideleft", () => {
    const r = buildTransitionFilter({
      inLabelA: "[a]", inLabelB: "[b]",
      clipADurationMs: 3000,
      transition: { type: "slide-left", durationMs: 500 },
      outLabel: "[ab]",
    });
    expect(r.filter).toContain("xfade=transition=slideleft");
  });

  it("slide-right emits xfade=transition=slideright", () => {
    const r = buildTransitionFilter({
      inLabelA: "[a]", inLabelB: "[b]",
      clipADurationMs: 3000,
      transition: { type: "slide-right", durationMs: 500 },
      outLabel: "[ab]",
    });
    expect(r.filter).toContain("xfade=transition=slideright");
  });

  it("none emits a concat-style passthrough (no overlap)", () => {
    const r = buildTransitionFilter({
      inLabelA: "[a]", inLabelB: "[b]",
      clipADurationMs: 3000,
      transition: { type: "none", durationMs: 0 },
      outLabel: "[ab]",
    });
    expect(r.filter).toContain("concat=n=2");
    expect(r.filter).not.toContain("xfade");
  });

  it("xfade output duration = clipA + clipB - transitionDuration", () => {
    const r = buildTransitionFilter({
      inLabelA: "[a]", inLabelB: "[b]",
      clipADurationMs: 5000,
      clipBDurationMs: 4000,
      transition: { type: "crossfade", durationMs: 500 },
      outLabel: "[ab]",
    });
    // Note: xfade overlaps the two clips by transitionDuration.
    // Output duration should be 5000 + 4000 - 500 = 8500ms.
    expect(r.outputDurationMs).toBe(8500);
  });

  it("none output duration = clipA + clipB (no overlap)", () => {
    const r = buildTransitionFilter({
      inLabelA: "[a]", inLabelB: "[b]",
      clipADurationMs: 3000,
      clipBDurationMs: 2000,
      transition: { type: "none", durationMs: 0 },
      outLabel: "[ab]",
    });
    expect(r.outputDurationMs).toBe(5000);
  });
});
