import { describe, it, expect } from "vitest";
import { buildFfmpegArgs } from "../../src/compositor.js";
import type { Manifest } from "../../src/manifest.js";
import type { DemoAst } from "../../src/types.js";

const baseManifest: Manifest = {
  version: 2,
  demoFile: "/x.demo",
  captureMode: "continuous",
  viewport: { width: 1440, height: 900 },
  createdAt: "2026-05-07T00:00:00Z",
  scenes: [{ index: 0, title: "x", slug: "x", sourceLine: 1, tStartMs: 0, tEndMs: 5000 }],
  markers: [],
};
const baseAst: DemoAst = {
  frontmatter: {
    title: "x", url: "http://localhost",
    intro: false, outro: false,
  } as any,
  scenes: [{ sourceLine: 1, title: "x", prose: "", overlays: [] }],
};

function fakePaths(rawVideo: string, output: string) {
  return {
    dir: "art",
    capture: {
      dir: "art/capture",
      manifest: "art/capture/capture.json",
      events: "art/capture/events.json",
      rawVideo,
      scenesDir: "art/capture/scenes",
    },
    output,
    composeLog: "art/compose.log",
  };
}

describe("buildFfmpegArgs (v0.2 v0.1-parity)", () => {
  it("emits a transcode-only argv when there is no music", () => {
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/capture/page.webm", "art/out.mp4"),
      manifest: baseManifest,
      ast: baseAst,
      musicSrc: null,
    });
    expect(argv).toContain("-i");
    expect(argv).toContain("art/capture/page.webm");
    expect(argv).toContain("-an");
    expect(argv).toContain("art/out.mp4");
    expect(argv.join(" ")).not.toContain("amix");
  });

  it("mixes music when provided, with default volume 0.4", () => {
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/capture/page.webm", "art/out.mp4"),
      manifest: baseManifest,
      ast: baseAst,
      musicSrc: "art/m.mp3",
    });
    expect(argv).toContain("art/m.mp3");
    expect(argv.join(" ")).toMatch(/\[1:a\]volume=0\.4\[m\]/);
    expect(argv.join(" ")).toMatch(/-map 0:v/);
    expect(argv.join(" ")).toMatch(/-map \[m\]/);
    expect(argv).toContain("aac");
  });

  it("respects an explicit musicVolume", () => {
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/capture/page.webm", "art/out.mp4"),
      manifest: baseManifest,
      ast: baseAst,
      musicSrc: "art/m.mp3",
      musicVolume: 0.1,
    });
    expect(argv.join(" ")).toMatch(/volume=0\.1/);
  });

  it("uses libx264 codec for video", () => {
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/capture/page.webm", "art/out.mp4"),
      manifest: baseManifest,
      ast: baseAst,
      musicSrc: null,
    });
    expect(argv).toContain("libx264");
  });
});
