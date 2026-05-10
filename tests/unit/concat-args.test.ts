import { describe, it, expect } from "vitest";
import { buildConcatList, buildStitchArgs } from "../../src/core/concat.js";

describe("buildConcatList", () => {
  it("emits 'file' lines with single-quote escaping for ffmpeg concat demuxer", () => {
    const txt = buildConcatList([
      "/abs/scene-001.webm",
      "/abs/cap with space/scene-002.webm",
    ]);
    expect(txt.trim().split("\n")).toEqual([
      "file '/abs/scene-001.webm'",
      "file '/abs/cap with space/scene-002.webm'",
    ]);
  });

  it("escapes single quotes in paths", () => {
    const txt = buildConcatList(["/abs/it's/scene-001.webm"]);
    expect(txt.trim()).toBe(`file '/abs/it'\\''s/scene-001.webm'`);
  });
});

describe("buildStitchArgs", () => {
  it("uses concat demuxer + libx264, no audio when no music", () => {
    const a = buildStitchArgs({ listFile: "/tmp/list.txt", music: null, output: "/o.mp4" });
    expect(a).toEqual(["-y","-f","concat","-safe","0","-i","/tmp/list.txt","-an","-c:v","libx264","/o.mp4"]);
  });
  it("muxes music with default volume 0.4", () => {
    const a = buildStitchArgs({ listFile: "/tmp/list.txt", music: "/m.mp3", output: "/o.mp4" });
    expect(a).toEqual([
      "-y","-f","concat","-safe","0","-i","/tmp/list.txt",
      "-i","/m.mp3",
      "-filter_complex","[1:a]volume=0.4[m]",
      "-map","0:v","-map","[m]",
      "-c:v","libx264","-c:a","aac",
      "-shortest",
      "/o.mp4",
    ]);
  });

  it("sidechain-ducks music against narration when musicDuck=true", () => {
    const a = buildStitchArgs({
      listFile: "/tmp/list.txt",
      music: "/m.mp3",
      output: "/o.mp4",
      musicDuck: true,
    });
    expect(a).toEqual([
      "-y","-f","concat","-safe","0","-i","/tmp/list.txt",
      "-i","/m.mp3",
      "-filter_complex",
      "[1:a]volume=0.4[bg];[bg][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[ducked];[ducked][0:a]amix=inputs=2:duration=first[final]",
      "-map","0:v","-map","[final]",
      "-c:v","libx264","-c:a","aac",
      "-shortest",
      "/o.mp4",
    ]);
  });

  it("falls back to constant volume when musicDuck=false", () => {
    const a = buildStitchArgs({ listFile: "/tmp/list.txt", music: "/m.mp3", output: "/o.mp4", musicDuck: false });
    expect(a).toEqual([
      "-y","-f","concat","-safe","0","-i","/tmp/list.txt",
      "-i","/m.mp3",
      "-filter_complex","[1:a]volume=0.4[m]",
      "-map","0:v","-map","[m]",
      "-c:v","libx264","-c:a","aac",
      "-shortest",
      "/o.mp4",
    ]);
  });
});
