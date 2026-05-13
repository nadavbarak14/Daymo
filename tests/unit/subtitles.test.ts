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

  // Pull the karaoke text (last comma-separated field) out of a Dialogue line.
  // Dialogue: Layer,Start,End,Style,Name,ML,MR,MV,Effect,Text — Text is field 10.
  function extractKaraoke(ass: string): string {
    const line = ass.split("\n").find((l) => l.startsWith("Dialogue:"))!;
    return line.split(",").slice(9).join(",");
  }

  // Sum all {\kN} durations in centiseconds.
  function sumK(text: string): number {
    let total = 0;
    for (const m of text.matchAll(/\\k(\d+)/g)) total += Number(m[1]);
    return total;
  }

  describe("karaoke ↔ audio sync (different TTS providers / voices / speeds)", () => {
    // The cumulative karaoke clock (sum of {\k} up to and including word i)
    // MUST equal word[i].endMs in centiseconds. That's the structural
    // invariant: at any word boundary, the karaoke highlight matches the
    // audio sample, regardless of what shape the provider's timings take.
    function assertKaraokeMatchesWords(
      words: { word: string; startMs: number; endMs: number }[],
    ): void {
      const ass = buildAss({
        events: [{ t: 0, durationMs: words[words.length - 1].endMs, words }],
      });
      const text = extractKaraoke(ass);
      // Walk \k tags in order, tracking the running karaoke clock.
      const tags = [...text.matchAll(/\\k(\d+)/g)].map((m) => Number(m[1]));
      // The first \k for each word is preceded by exactly one (possibly zero)
      // gap \k. Reconstruct by stepping word-by-word using the same logic:
      // pop gap (may be absent → 0), then pop word duration, sum, verify.
      let cursorCs = 0;
      let tagIdx = 0;
      for (const w of words) {
        const expectStartCs = Math.round(w.startMs / 10);
        const expectEndCs = Math.round(w.endMs / 10);
        // Gap (skipped if zero — buildKaraokeText omits the tag).
        if (cursorCs < expectStartCs) {
          expect(tags[tagIdx]).toBe(expectStartCs - cursorCs);
          cursorCs += tags[tagIdx];
          tagIdx++;
        }
        // Word duration.
        expect(tags[tagIdx]).toBe(expectEndCs - expectStartCs);
        cursorCs += tags[tagIdx];
        tagIdx++;
        // Karaoke clock now sits exactly on the word's end in the audio.
        expect(cursorCs).toBe(expectEndCs);
      }
    }

    it("preroll silence: gap {\\k} inserted so karaoke waits for first word", () => {
      // Edge TTS commonly starts speech ~80ms in. Without the leading gap,
      // the first word highlights 8cs before audio plays it.
      const words = [
        { word: "Hello", startMs: 80, endMs: 380 },
        { word: "world", startMs: 380, endMs: 980 },
      ];
      const ass = buildAss({ events: [{ t: 0, durationMs: 980, words }] });
      const text = extractKaraoke(ass);
      // Karaoke begins with an 8cs silent block before "Hello".
      expect(text.startsWith("{\\k8}{\\k30}Hello ")).toBe(true);
      assertKaraokeMatchesWords(words);
    });

    it("inter-word gaps (pauses after punctuation) keep highlight on the audio sample", () => {
      // "Hello, world." — comma adds ~150ms pause between words.
      const words = [
        { word: "Hello,", startMs: 0, endMs: 400 },
        { word: "world.", startMs: 550, endMs: 1100 },
      ];
      const text = extractKaraoke(buildAss({ events: [{ t: 0, durationMs: 1100, words }] }));
      // 40cs word, 15cs pause, 55cs word.
      expect(text).toContain("{\\k40}Hello, ");
      expect(text).toContain("{\\k15}{\\k55}world.");
      assertKaraokeMatchesWords(words);
    });

    it("slow voice with long preroll + multiple gaps stays synced end-to-end", () => {
      // Simulates a slower voice (e.g. rate=-25%) with realistic silences.
      const words = [
        { word: "The",   startMs: 120,  endMs: 350  },
        { word: "quick", startMs: 410,  endMs: 880  },
        { word: "brown", startMs: 950,  endMs: 1480 },
        { word: "fox.",  startMs: 1620, endMs: 2300 },
      ];
      assertKaraokeMatchesWords(words);
      // Total karaoke clock should land exactly on the last word's end —
      // which is what the Dialogue end (ev.t + durationMs) also represents.
      const text = extractKaraoke(buildAss({ events: [{ t: 0, durationMs: 2300, words }] }));
      expect(sumK(text)).toBe(Math.round(2300 / 10));
    });

    it("zero-gap timings (e.g. mock provider) emit no superfluous {\\k0}", () => {
      // Provider with contiguous timings (mock TTS): no gap tags needed.
      const words = [
        { word: "a", startMs: 0,   endMs: 500  },
        { word: "b", startMs: 500, endMs: 1000 },
      ];
      const text = extractKaraoke(buildAss({ events: [{ t: 0, durationMs: 1000, words }] }));
      expect(text).toBe("{\\k50}a {\\k50}b");
      expect(text).not.toContain("{\\k0}");
    });
  });
});
