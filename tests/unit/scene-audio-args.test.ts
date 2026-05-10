import { describe, it, expect } from "vitest";
import { buildSceneAudioArgs } from "../../src/core/scene-audio.js";

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
        { hash: "h1", t: 500 },
        { hash: "h2", t: 4750 },
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
      sayEvents: [{ hash: "h1", t: 0 }],
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
});
