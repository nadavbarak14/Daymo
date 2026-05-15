import { describe, it, expect } from "vitest";
import { buildWebVtt } from "../../src/core/captions-vtt.js";
import type { SayEventForVtt } from "../../src/core/captions-vtt.js";

describe("buildWebVtt", () => {
  it("emits a WEBVTT header and an empty body for zero events", () => {
    expect(buildWebVtt([])).toBe("WEBVTT\n\n");
  });

  it("emits one cue per say event using its global start + duration", () => {
    const says: SayEventForVtt[] = [
      { globalStartMs: 1500, durationMs: 2200, text: "Hello, world." },
      { globalStartMs: 5000, durationMs: 1500, text: "Second clause." },
    ];
    const vtt = buildWebVtt(says);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:01.500 --> 00:00:03.700");
    expect(vtt).toContain("Hello, world.");
    expect(vtt).toContain("00:00:05.000 --> 00:00:06.500");
    expect(vtt).toContain("Second clause.");
  });

  it("formats timestamps as HH:MM:SS.mmm and zero-pads correctly", () => {
    const says: SayEventForVtt[] = [
      { globalStartMs: 3_661_007, durationMs: 1, text: "x" },
    ];
    const vtt = buildWebVtt(says);
    expect(vtt).toContain("01:01:01.007 --> 01:01:01.008");
  });
});
