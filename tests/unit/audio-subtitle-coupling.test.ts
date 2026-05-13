// tests/unit/audio-subtitle-coupling.test.ts
//
// STRUCTURAL INVARIANT: per-scene audio mix and per-scene subtitle burn-in
// must use identical time offsets. This is the whole point of moving
// subtitles out of the browser into ffmpeg — they have to come from the
// same source (ev.t) so they cannot drift.
//
// If anyone ever changes the audio path or the subtitle path independently
// (e.g. shifts adelay or shifts the ASS Dialogue start), this test fails
// loudly. That's the regression guard.
import { describe, it, expect } from "vitest";
import { buildSceneAudioArgs, type SayEvent } from "../../src/core/scene-audio.js";
import { buildAss, formatAssTime } from "../../src/core/subtitles.js";

const W = (word: string, startMs: number, endMs: number) => ({ word, startMs, endMs });

/** Parse the adelay value(s) from a `-filter_complex` argv list. */
function extractAdelays(args: string[]): number[] {
  const fcIdx = args.indexOf("-filter_complex");
  if (fcIdx === -1) return [];
  const fc = args[fcIdx + 1];
  // adelay=NNN|NNN
  const re = /adelay=(\d+)\|\d+/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fc)) !== null) out.push(Number(m[1]));
  return out;
}

/** Parse Dialogue start times (in ms) from an ASS string. */
function extractDialogueStartsMs(ass: string): number[] {
  const out: number[] = [];
  for (const line of ass.split("\n")) {
    if (!line.startsWith("Dialogue:")) continue;
    // Dialogue: <Layer>,<Start>,<End>,...
    const parts = line.split(",");
    const t = parts[1]; // H:MM:SS.cs
    const m = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(t.trim());
    if (!m) continue;
    const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]) * 10;
    out.push(ms);
  }
  return out;
}

describe("audio + subtitle structural coupling", () => {
  it("single say: ASS Dialogue start == audio adelay (same ev.t)", () => {
    const events: SayEvent[] = [{
      hash: "h1",
      t: 7000,
      durationMs: 1500,
      words: [W("hello", 0, 600), W("world", 600, 1500)],
    }];
    const args = buildSceneAudioArgs({
      sceneWebm: "/scene.webm",
      output: "/out.webm",
      sayEvents: events,
      ttsDir: "/tts",
      subtitlePath: "/scene.ass",
    });
    const ass = buildAss({ events: events.map((e) => ({ t: e.t, durationMs: e.durationMs, words: e.words })) });

    const adelays = extractAdelays(args);
    const dialogueStarts = extractDialogueStartsMs(ass);

    expect(adelays).toEqual([7000]);
    expect(dialogueStarts).toEqual([7000]);
    // The invariant the user demanded — same offset, same source.
    expect(dialogueStarts).toEqual(adelays);
  });

  it("multiple says: every adelay has a matching Dialogue start", () => {
    const events: SayEvent[] = [
      { hash: "h1", t: 0, durationMs: 1000, words: [W("a", 0, 1000)] },
      { hash: "h2", t: 4500, durationMs: 800, words: [W("b", 0, 800)] },
      { hash: "h3", t: 12345, durationMs: 600, words: [W("c", 0, 600)] },
    ];
    const args = buildSceneAudioArgs({
      sceneWebm: "/scene.webm",
      output: "/out.webm",
      sayEvents: events,
      ttsDir: "/tts",
      subtitlePath: "/scene.ass",
    });
    const ass = buildAss({ events: events.map((e) => ({ t: e.t, durationMs: e.durationMs, words: e.words })) });

    expect(extractAdelays(args).sort((a, b) => a - b))
      .toEqual(extractDialogueStartsMs(ass).sort((a, b) => a - b));
  });

  it("subtitle burn and audio mix share one -filter_complex (one ffmpeg pass)", () => {
    const events: SayEvent[] = [{
      hash: "h1", t: 1000, durationMs: 500, words: [W("x", 0, 500)],
    }];
    const args = buildSceneAudioArgs({
      sceneWebm: "/scene.webm",
      output: "/out.webm",
      sayEvents: events,
      ttsDir: "/tts",
      subtitlePath: "/scene.ass",
    });
    // Exactly one -filter_complex in the argv. Both adelay and subtitles
    // live inside it — they cannot be split across passes.
    const occurrences = args.filter((a) => a === "-filter_complex").length;
    expect(occurrences).toBe(1);
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toMatch(/adelay=1000\|1000/);
    expect(fc).toMatch(/subtitles=filename='[^']*\.ass'/);
  });

  it("formatAssTime is invertible: parsing the formatted output recovers the ms", () => {
    // Round-trip guarantees the time-format helper itself can't introduce drift.
    for (const ms of [0, 500, 1000, 7000, 12345, 60_000, 3_600_000]) {
      const ass = formatAssTime(ms);
      const m = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(ass)!;
      const parsed = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]) * 10;
      // Rounding to centiseconds may lose <10ms; the invariant we care about
      // is alignment, not millisecond exactness.
      expect(Math.abs(parsed - ms)).toBeLessThan(10);
    }
  });
});
