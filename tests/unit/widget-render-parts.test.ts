// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderParts } from "../../widget/src/render-parts.js";
import { resolveVideoSource, type ManifestDemo } from "../../widget/src/manifest.js";
import type { Part, VideoPart } from "../../widget/src/types.js";

const noop = (_p: VideoPart): void => { /* no-op */ };
const noManifest = (p: VideoPart) => resolveVideoSource(p, new Map());

describe("renderParts", () => {
  it("renders a TextPart as a paragraph with the text content", () => {
    const parts: Part[] = [{ kind: "text", text: "Hello world." }];
    const root = document.createElement("div");
    renderParts(root, parts, noop, noManifest);
    expect(root.querySelector("p")?.textContent).toBe("Hello world.");
  });

  it("renders a VideoPart as a clickable button tile with a #t= thumbnail video inside", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1500, endMs: 3500, caption: "Open dialog", mp4Url: "https://x/d.mp4" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts, noop, noManifest);
    // Tile itself: a <button> the user clicks to open the lightbox.
    const tile = root.querySelector("button.dw-video-card") as HTMLButtonElement | null;
    expect(tile).not.toBeNull();
    expect(tile!.getAttribute("type")).toBe("button");
    // Thumbnail seeks to the clip's start (single #t=startSec, no controls).
    const v = tile!.querySelector("video") as HTMLVideoElement | null;
    expect(v).not.toBeNull();
    expect(v!.src).toBe("https://x/d.mp4#t=1.5");
    expect(v!.getAttribute("preload")).toBe("metadata");
    expect(v!.getAttribute("playsinline")).not.toBeNull();
    expect(v!.controls).toBe(false);
  });

  it("uses the help-center poster (no inline video) when the demo is in the shared manifest", () => {
    const demos = new Map<string, ManifestDemo>([
      ["d", { demoId: "d", title: "Tour", videoUrl: "https://cdn/help/d/output.mp4", posterUrl: "https://cdn/help/d/poster.jpg" }],
    ]);
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 16000, caption: "Open dialog", mp4Url: "https://x/d.mp4" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts, noop, (p) => resolveVideoSource(p, demos));
    const thumb = root.querySelector(".dw-thumb") as HTMLElement;
    expect(thumb.style.backgroundImage).toContain("https://cdn/help/d/poster.jpg");
    expect(thumb.querySelector("video")).toBeNull();
  });

  it("shows the clip duration on the thumbnail", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 30000, endMs: 46000, caption: "c", mp4Url: "u" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts, noop, noManifest);
    expect(root.querySelector(".dw-duration")?.textContent).toBe("0:16");
  });

  it("renders the caption in the card foot label", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 1000, caption: "Loomly · Open · 0:00-0:01", mp4Url: "x" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts, noop, noManifest);
    expect(root.querySelector(".dw-card-foot .dw-card-label")?.textContent).toBe("Loomly · Open · 0:00-0:01");
  });

  it("invokes onPlay with the VideoPart when the tile is clicked", () => {
    const part: VideoPart = { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "Step", mp4Url: "u" };
    const onPlay = vi.fn();
    const root = document.createElement("div");
    renderParts(root, [part], onPlay, noManifest);
    (root.querySelector("button.dw-video-card") as HTMLButtonElement).click();
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(part);
  });

  it("renders multiple parts in order", () => {
    const parts: Part[] = [
      { kind: "text", text: "First:" },
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 1000, caption: "c1", mp4Url: "u1" },
      { kind: "text", text: "Then:" },
      { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 0, endMs: 1000, caption: "c2", mp4Url: "u2" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts, noop, noManifest);
    const children = Array.from(root.children);
    expect(children[0].tagName.toLowerCase()).toBe("p");
    expect(children[1].tagName.toLowerCase()).toBe("button");
    expect(children[2].tagName.toLowerCase()).toBe("p");
    expect(children[3].tagName.toLowerCase()).toBe("button");
  });

  it("escapes text content (no HTML injection)", () => {
    const parts: Part[] = [{ kind: "text", text: "<script>alert(1)</script>" }];
    const root = document.createElement("div");
    renderParts(root, parts, noop, noManifest);
    expect(root.innerHTML).not.toContain("<script>");
    expect(root.querySelector("p")?.textContent).toBe("<script>alert(1)</script>");
  });
});
