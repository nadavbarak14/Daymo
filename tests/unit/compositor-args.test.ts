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

describe("buildFfmpegArgs (slates)", () => {
  it("includes intro and outro mp4 paths in the input list when slatePaths are provided", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [{ index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0, tEndMs: 3000 }],
      markers: [],
    };
    const ast: DemoAst = {
      frontmatter: { title: "T", description: "D", url: "x" } as any,
      scenes: [{ sourceLine: 1, title: "a", prose: "", overlays: [] }],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null,
      slatePaths: { intro: "art/intro.mp4", outro: "art/outro.mp4" },
      slateConfigs: { intro: { durationMs: 2500 }, outro: { durationMs: 2000 } },
    });
    expect(argv.join(" ")).toContain("art/intro.mp4");
    expect(argv.join(" ")).toContain("art/outro.mp4");
    const fc = argv[argv.indexOf("-filter_complex") + 1];
    // Two xfades: intro→scene0 and scene0→outro.
    const xfadeMatches = fc.match(/xfade=/g) ?? [];
    expect(xfadeMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("does not add intro/outro when slatePaths.intro/outro are null", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [{ index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0, tEndMs: 3000 }],
      markers: [],
    };
    const ast: DemoAst = {
      frontmatter: { title: "T", url: "x", intro: false, outro: false } as any,
      scenes: [{ sourceLine: 1, title: "a", prose: "", overlays: [] }],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null,
      slatePaths: { intro: null, outro: null },
    });
    expect(argv.join(" ")).not.toContain("intro.mp4");
    expect(argv.join(" ")).not.toContain("outro.mp4");
  });

  it("adds slates AFTER the music input in the -i list (so music is input 1)", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [{ index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0, tEndMs: 3000 }],
      markers: [],
    };
    const ast: DemoAst = {
      frontmatter: { title: "T", url: "x" } as any,
      scenes: [{ sourceLine: 1, title: "a", prose: "", overlays: [] }],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: "art/m.mp3",
      slatePaths: { intro: "art/intro.mp4", outro: "art/outro.mp4" },
      slateConfigs: { intro: { durationMs: 2500 }, outro: { durationMs: 2000 } },
    });
    // Find positions of -i flags
    const inputs: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === "-i") inputs.push(argv[i + 1]);
    }
    expect(inputs[0]).toBe("art/page.webm");
    expect(inputs[1]).toBe("art/m.mp3");
    expect(inputs[2]).toBe("art/intro.mp4");
    expect(inputs[3]).toBe("art/outro.mp4");
  });
});

describe("buildFfmpegArgs (markers)", () => {
  it("applies setpts=(PTS-STARTPTS)/factor to a fast_forward sub-segment", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [{ index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0, tEndMs: 6000 }],
      markers: [
        { kind: "fast_forward", sceneIndex: 0, tStartMs: 1000, tEndMs: 4000, factor: 3 },
      ],
    };
    const ast: DemoAst = {
      frontmatter: { title: "x", url: "x", intro: false, outro: false } as any,
      scenes: [{ sourceLine: 1, title: "a", prose: "", overlays: [] }],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null, slatePaths: { intro: null, outro: null },
    });
    const fc = argv[argv.indexOf("-filter_complex") + 1];
    // Three sub-segments around the marker (0..1, 1..4, 4..6) and a setpts-divide on the middle.
    expect(fc).toMatch(/trim=start=0(\.0+)?:end=1(\.0+)?/);
    expect(fc).toMatch(/trim=start=1(\.0+)?:end=4(\.0+)?/);
    expect(fc).toMatch(/trim=start=4(\.0+)?:end=6(\.0+)?/);
    expect(fc).toMatch(/setpts=\(PTS-STARTPTS\)\/3/);
  });

  it("drops a skip sub-segment entirely", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [{ index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0, tEndMs: 6000 }],
      markers: [{ kind: "skip", sceneIndex: 0, tStartMs: 2000, tEndMs: 5000 }],
    };
    const ast: DemoAst = {
      frontmatter: { title: "x", url: "x", intro: false, outro: false } as any,
      scenes: [{ sourceLine: 1, title: "a", prose: "", overlays: [] }],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null, slatePaths: { intro: null, outro: null },
    });
    const fc = argv[argv.indexOf("-filter_complex") + 1];
    expect(fc).toMatch(/trim=start=0(\.0+)?:end=2(\.0+)?/);
    expect(fc).toMatch(/trim=start=5(\.0+)?:end=6(\.0+)?/);
    expect(fc).not.toMatch(/trim=start=2(\.0+)?:end=5(\.0+)?/);
  });

  it("a scene with no markers still emits a single trim (no concat)", () => {
    const m: Manifest = {
      version: 2, demoFile: "/x", captureMode: "continuous",
      viewport: { width: 1440, height: 900 }, createdAt: "x",
      scenes: [{ index: 0, title: "a", slug: "a", sourceLine: 1, tStartMs: 0, tEndMs: 5000 }],
      markers: [],
    };
    const ast: DemoAst = {
      frontmatter: { title: "x", url: "x", intro: false, outro: false } as any,
      scenes: [{ sourceLine: 1, title: "a", prose: "", overlays: [] }],
    };
    const argv = buildFfmpegArgs({
      paths: fakePaths("art/page.webm", "art/out.mp4"),
      manifest: m, ast, musicSrc: null, slatePaths: { intro: null, outro: null },
    });
    const fc = argv[argv.indexOf("-filter_complex") + 1];
    // Single trim, no inner concat for the scene segment.
    expect(fc).toMatch(/trim=start=0(\.0+)?:end=5(\.0+)?/);
    // The compositor may add a fps/settb normalization when slates are present, but
    // for this all-disabled-slates case there should be no inner [s0_*]concat=n=… subgraph.
    expect(fc).not.toMatch(/\[s0_\d+\]/);
  });
});
