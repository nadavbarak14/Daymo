import { describe, it, expect, vi } from "vitest";
import { loadManifest, resolveVideoSource, type ManifestDemo } from "../../widget/src/manifest.js";
import type { VideoPart } from "../../widget/src/types.js";

const MANIFEST = {
  version: "1",
  videoBaseUrl: "https://cdn.example.com/help",
  demos: [
    {
      demoId: "create-project",
      title: "Create a project",
      description: "…",
      durationMs: 126_000,
      videoUrl: "https://cdn.example.com/help/create-project/output.mp4",
      posterUrl: "https://cdn.example.com/help/create-project/poster.jpg",
      steps: [],
    },
  ],
};

function part(demoId: string): VideoPart {
  return {
    kind: "video",
    stepId: "s1",
    demoId,
    startMs: 30_000,
    endMs: 46_000,
    caption: "Create a project",
    mp4Url: "https://api.example.com/widgets/w/demos/create-project/output.mp4",
  };
}

describe("loadManifest", () => {
  it("indexes the published help-center manifest by demoId", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => MANIFEST });
    const demos = await loadManifest("https://cdn.example.com/help/manifest.json", fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/help/manifest.json");
    expect(demos.size).toBe(1);
    expect(demos.get("create-project")?.posterUrl).toBe("https://cdn.example.com/help/create-project/poster.jpg");
  });

  it.each([
    ["http error", { ok: false, json: async () => ({}) }],
    ["malformed body", { ok: true, json: async () => ({ nope: true }) }],
  ])("resolves to an empty map on %s", async (_name, response) => {
    const fetchMock = vi.fn().mockResolvedValue(response);
    const demos = await loadManifest("/help/manifest.json", fetchMock as unknown as typeof fetch);
    expect(demos.size).toBe(0);
  });

  it("resolves to an empty map when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    const demos = await loadManifest("/help/manifest.json", fetchMock as unknown as typeof fetch);
    expect(demos.size).toBe(0);
  });

  it("skips demos without a demoId or videoUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...MANIFEST, demos: [...MANIFEST.demos, { demoId: "broken" }, { videoUrl: "x.mp4" }] }),
    });
    const demos = await loadManifest("/help/manifest.json", fetchMock as unknown as typeof fetch);
    expect([...demos.keys()]).toEqual(["create-project"]);
  });
});

describe("resolveVideoSource", () => {
  const demos = new Map<string, ManifestDemo>(
    MANIFEST.demos.map((d) => [d.demoId, d]),
  );

  it("prefers the help page's video and poster when the cited demo is in the manifest", () => {
    const source = resolveVideoSource(part("create-project"), demos);
    expect(source.mp4Url).toBe("https://cdn.example.com/help/create-project/output.mp4");
    expect(source.posterUrl).toBe("https://cdn.example.com/help/create-project/poster.jpg");
    expect(source.title).toBe("Create a project");
  });

  it("falls back to the chat backend's mp4Url when the demo is unknown", () => {
    const source = resolveVideoSource(part("other-demo"), demos);
    expect(source.mp4Url).toBe("https://api.example.com/widgets/w/demos/create-project/output.mp4");
    expect(source.posterUrl).toBeUndefined();
  });

  it("falls back when no manifest was loaded at all", () => {
    const source = resolveVideoSource(part("create-project"), new Map());
    expect(source.mp4Url).toBe("https://api.example.com/widgets/w/demos/create-project/output.mp4");
  });

  it("returns durationMs from the manifest when present", () => {
    const demosWithDuration = new Map<string, ManifestDemo>([
      ["d", { demoId: "d", title: "My Demo", videoUrl: "https://cdn/d.mp4", durationMs: 79000 }],
    ]);
    const source = resolveVideoSource({ demoId: "d", mp4Url: "https://fallback/d.mp4" }, demosWithDuration);
    expect(source.durationMs).toBe(79000);
  });
});
