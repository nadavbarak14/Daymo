// tests/unit/compositor-args.test.ts
import { describe, it, expect } from "vitest";
import { buildFfmpegArgs } from "../../src/compositor.js";

describe("buildFfmpegArgs", () => {
  it("emits a transcode-only argv when there is no music", () => {
    const argv = buildFfmpegArgs({ rawVideo: "art/raw.webm", music: null, output: "art/out.mp4" });
    expect(argv).toContain("-i");
    expect(argv).toContain("art/raw.webm");
    expect(argv).toContain("-an");
    expect(argv).toContain("art/out.mp4");
    expect(argv).not.toContain("amix");
  });

  it("mixes music when provided, with default volume 0.4", () => {
    const argv = buildFfmpegArgs({ rawVideo: "art/raw.webm", music: "art/m.mp3", output: "art/out.mp4" });
    expect(argv).toContain("art/m.mp3");
    expect(argv.join(" ")).toMatch(/\[1:a\]volume=0\.4\[m\]/);
    expect(argv.join(" ")).toMatch(/-map 0:v/);
    expect(argv.join(" ")).toMatch(/-map \[m\]/);
    expect(argv).toContain("aac");
  });

  it("respects an explicit musicVolume", () => {
    const argv = buildFfmpegArgs({ rawVideo: "art/raw.webm", music: "art/m.mp3", output: "art/out.mp4", musicVolume: 0.1 });
    expect(argv.join(" ")).toMatch(/volume=0\.1/);
  });

  it("uses libx264 codec for video", () => {
    const argv = buildFfmpegArgs({ rawVideo: "art/raw.webm", music: null, output: "art/out.mp4" });
    expect(argv).toContain("libx264");
  });
});
