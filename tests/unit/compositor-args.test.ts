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
    expect(argv.join(" ")).toMatch(/\[1:a\]volume=0\.4/);
    expect(argv.join(" ")).toMatch(/-map \[s0\]/);
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

describe("buildFfmpegArgs (transitions)", () => {
  it("trims the captured video into per-scene segments and joins with crossfade", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [
        { index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0,    tEndMs: 4000 },
        { index: 1, title: "b", slug: "b", sourceLine: 2, tStartMs: 4000, tEndMs: 9000 },
      ],
      markers: [],
    };
    const ast: DemoAst = {
      frontmatter: {
        title: "x", url: "x",
        defaultTransition: "crossfade", transitionDuration: "0.5s",
        intro: false, outro: false,
      } as any,
      scenes: [
        { sourceLine: 1, title: "a", prose: "", overlays: [] },
        { sourceLine: 2, title: "b", prose: "", overlays: [] },
      ],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null,
    });
    const fcIdx = argv.indexOf("-filter_complex");
    expect(fcIdx).toBeGreaterThan(-1);
    const fc = argv[fcIdx + 1];
    expect(fc).toMatch(/trim=start=0(\.0+)?:end=4(\.0+)?/);
    expect(fc).toMatch(/trim=start=4(\.0+)?:end=9(\.0+)?/);
    expect(fc).toContain("xfade=transition=fade");
    expect(fc).toMatch(/duration=0\.500/);
  });

  it("honors a per-scene transition override", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [
        { index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0,    tEndMs: 4000 },
        { index: 1, title: "b", slug: "b", sourceLine: 2, tStartMs: 4000, tEndMs: 9000 },
      ],
      markers: [],
    };
    const ast: DemoAst = {
      frontmatter: {
        title: "x", url: "x",
        defaultTransition: "crossfade",
        intro: false, outro: false,
      } as any,
      scenes: [
        { sourceLine: 1, title: "a", prose: "", overlays: [] },
        { sourceLine: 2, title: "b", prose: "", overlays: [],
          transition: { type: "dip-to-black", durationMs: 800 } },
      ],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null,
    });
    const fc = argv[argv.indexOf("-filter_complex") + 1];
    expect(fc).toContain("xfade=transition=fadeblack");
    expect(fc).toMatch(/duration=0\.800/);
  });

  it("uses defaultTransition: none for hard cuts", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [
        { index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0,    tEndMs: 3000 },
        { index: 1, title: "b", slug: "b", sourceLine: 2, tStartMs: 3000, tEndMs: 6000 },
      ],
      markers: [],
    };
    const ast: DemoAst = {
      frontmatter: {
        title: "x", url: "x",
        defaultTransition: "none",
        intro: false, outro: false,
      } as any,
      scenes: [
        { sourceLine: 1, title: "a", prose: "", overlays: [] },
        { sourceLine: 2, title: "b", prose: "", overlays: [] },
      ],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null,
    });
    const fc = argv[argv.indexOf("-filter_complex") + 1];
    expect(fc).toContain("concat=n=2");
    expect(fc).not.toContain("xfade");
  });

  it("handles single-scene demos without a transition pair", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [{ index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0, tEndMs: 5000 }],
      markers: [],
    };
    const ast: DemoAst = {
      frontmatter: {
        title: "x", url: "x", intro: false, outro: false,
      } as any,
      scenes: [{ sourceLine: 1, title: "a", prose: "", overlays: [] }],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null,
    });
    const fc = argv[argv.indexOf("-filter_complex") + 1];
    expect(fc).toMatch(/trim=start=0(\.0+)?:end=5(\.0+)?/);
    expect(fc).not.toContain("xfade");
    expect(fc).not.toContain("concat");
  });
});
