import { describe, it, expect } from "vitest";
import { buildAss, formatAssTime } from "../../src/core/subtitles.js";

describe("formatAssTime", () => {
  it("formats 0 ms as 0:00:00.00", () => {
    expect(formatAssTime(0)).toBe("0:00:00.00");
  });
  it("formats 7000 ms as 0:00:07.00", () => {
    expect(formatAssTime(7000)).toBe("0:00:07.00");
  });
  it("formats sub-second as centiseconds", () => {
    expect(formatAssTime(1234)).toBe("0:00:01.23");
  });
  it("rolls over minutes and hours", () => {
    expect(formatAssTime(3_600_000)).toBe("1:00:00.00");
    expect(formatAssTime(125_500)).toBe("0:02:05.50");
  });
});

describe("buildAss", () => {
  it("emits one Dialogue per say event with karaoke-tagged words", () => {
    const ass = buildAss({
      events: [{
        t: 7000,
        durationMs: 1000,
        words: [
          { word: "Hello", startMs: 0, endMs: 300 },
          { word: "world", startMs: 300, endMs: 1000 },
        ],
      }],
    });
    // Standard ASS sections present
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("[Events]");
    // Dialogue line: start = ev.t, end = ev.t + durationMs, both in ASS time
    expect(ass).toContain("Dialogue: 0,0:00:07.00,0:00:08.00,Default,");
    // Karaoke tags: 300ms = 30cs, 700ms = 70cs
    expect(ass).toContain("{\\k30}Hello ");
    expect(ass).toContain("{\\k70}world");
  });

  it("emits one Dialogue per event when there are multiple says", () => {
    const ass = buildAss({
      events: [
        { t: 1000, durationMs: 500, words: [{ word: "first", startMs: 0, endMs: 500 }] },
        { t: 5000, durationMs: 500, words: [{ word: "second", startMs: 0, endMs: 500 }] },
      ],
    });
    const dialogues = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(dialogues).toHaveLength(2);
    expect(dialogues[0]).toContain("0:00:01.00,0:00:01.50");
    expect(dialogues[1]).toContain("0:00:05.00,0:00:05.50");
  });

  it("escapes ASS-special braces in word text", () => {
    const ass = buildAss({
      events: [{
        t: 0,
        durationMs: 100,
        words: [{ word: "a{b}c", startMs: 0, endMs: 100 }],
      }],
    });
    expect(ass).toContain("a(b)c");
    expect(ass).not.toContain("a{b}c");
  });
});
