import { describe, it, expect } from "vitest";
import { buildConcatList, buildStitchArgs } from "../../src/editor/concat.js";

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
      "/o.mp4",
    ]);
  });
});
