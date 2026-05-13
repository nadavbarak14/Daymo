import { describe, it, expect } from "vitest";
import { buildSceneAudioArgs } from "../../src/core/scene-audio.js";

const W = (word: string, startMs: number, endMs: number) => ({ word, startMs, endMs });

describe("buildSceneAudioArgs", () => {
  it("returns input args + concat for video-only when no say events", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [],
      ttsDir: "/tts",
    });
    expect(a).toEqual(["-y", "-i", "/cap/scene-001.webm", "-c", "copy", "/cap/scene-001.with-audio.webm"]);
  });

  it("delays each TTS file by its t and amixes when 2+ events", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [
        { hash: "h1", t: 500, durationMs: 1000, words: [W("a", 0, 1000)] },
        { hash: "h2", t: 4750, durationMs: 1000, words: [W("b", 0, 1000)] },
      ],
      ttsDir: "/tts",
    });
    expect(a).toEqual([
      "-y",
      "-i", "/cap/scene-001.webm",
      "-i", "/tts/h1.mp3",
      "-i", "/tts/h2.mp3",
      "-filter_complex",
      "[1:a]adelay=500|500[a1];[2:a]adelay=4750|4750[a2];[a1][a2]amix=inputs=2:duration=longest[narr]",
      "-map", "0:v",
      "-map", "[narr]",
      "-c:v", "copy",
      "-c:a", "libopus",
      "/cap/scene-001.with-audio.webm",
    ]);
  });

  it("single say event uses adelay alone (no amix)", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [{ hash: "h1", t: 0, durationMs: 500, words: [W("a", 0, 500)] }],
      ttsDir: "/tts",
    });
    expect(a).toEqual([
      "-y",
      "-i", "/cap/scene-001.webm",
      "-i", "/tts/h1.mp3",
      "-filter_complex",
      "[1:a]adelay=0|0[narr]",
      "-map", "0:v",
      "-map", "[narr]",
      "-c:v", "copy",
      "-c:a", "libopus",
      "/cap/scene-001.with-audio.webm",
    ]);
  });

  it("burns subtitles in the same -filter_complex as the audio mix", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [{ hash: "h1", t: 7000, durationMs: 1000, words: [W("hi", 0, 1000)] }],
      ttsDir: "/tts",
      subtitlePath: "/cap/scene-001.ass",
    });
    // Audio adelay AND subtitle burn are in the same filter graph: that is
    // the structural coupling. Both chains use the same source data (ev.t).
    const fcIdx = a.indexOf("-filter_complex");
    expect(fcIdx).toBeGreaterThan(-1);
    const fc = a[fcIdx + 1];
    expect(fc).toContain("[1:a]adelay=7000|7000[narr]");
    expect(fc).toContain("[0:v]subtitles=filename='/cap/scene-001.ass'[vout]");
    expect(a).toContain("-map");
    expect(a).toContain("[vout]");
    expect(a).toContain("[narr]");
    // Video is re-encoded (subs need it); audio is opus.
    expect(a).toContain("libvpx-vp9");
    expect(a).toContain("libopus");
  });

  it("video-only with trim: input-side -ss seeks past the page-load prefix", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.trimmed.webm",
      sayEvents: [],
      ttsDir: "/tts",
      videoStartOffsetMs: 3600,
    });
    expect(a).toEqual([
      "-y",
      "-ss", "3.600",
      "-i", "/cap/scene-001.webm",
      "-c", "copy",
      "/cap/scene-001.trimmed.webm",
    ]);
  });

  it("audio + subs + trim: -ss precedes -i so the filter graph runs on the trimmed input", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [{ hash: "h1", t: 1000, durationMs: 500, words: [W("x", 0, 500)] }],
      ttsDir: "/tts",
      subtitlePath: "/cap/scene-001.ass",
      videoStartOffsetMs: 3600,
    });
    // -ss MUST come before the matching -i, otherwise ffmpeg treats it as an
    // output-side seek (slower decode, and would shift the audio start too).
    const ssIdx = a.indexOf("-ss");
    const firstIIdx = a.indexOf("-i");
    expect(ssIdx).toBeGreaterThan(-1);
    expect(ssIdx).toBeLessThan(firstIIdx);
    expect(a[ssIdx + 1]).toBe("3.600");
    // adelay value is NOT shifted by the trim — events.json `t` is already
    // relative to scene_start, which equals the trim point on the webm.
    const fc = a[a.indexOf("-filter_complex") + 1];
    expect(fc).toContain("adelay=1000|1000");
  });

  it("escapes Windows drive-letter colons in subtitle path", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [],
      ttsDir: "/tts",
      subtitlePath: "C:\\Users\\x\\scene.ass",
    });
    const fcIdx = a.indexOf("-filter_complex");
    const fc = a[fcIdx + 1];
    // Backslashes → forward slashes; colon escaped to \:
    expect(fc).toContain(`subtitles=filename='C\\:/Users/x/scene.ass'`);
  });
});
