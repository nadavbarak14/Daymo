// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderParts } from "../../widget/src/render-parts.js";
import type { Part, VideoPart } from "../../widget/src/types.js";

const noop = (_p: VideoPart): void => { /* no-op */ };

describe("renderParts", () => {
  it("renders a TextPart as a paragraph with the text content", () => {
    const parts: Part[] = [{ kind: "text", text: "Hello world." }];
    const root = document.createElement("div");
    renderParts(root, parts, noop);
    expect(root.querySelector("p")?.textContent).toBe("Hello world.");
  });

  it("renders a VideoPart as a clickable button tile with a #t= thumbnail video inside", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1500, endMs: 3500, caption: "Open dialog", mp4Url: "https://x/d.mp4" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts, noop);
    // Tile itself: a <button> the user clicks to open the lightbox.
    const tile = root.querySelector("button.video-card") as HTMLButtonElement | null;
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

  it("renders the caption in the card header label", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 1000, caption: "Loomly · Open · 0:00-0:01", mp4Url: "x" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts, noop);
    expect(root.querySelector(".video-card-header .label")?.textContent).toBe("Loomly · Open · 0:00-0:01");
  });

  it("invokes onPlay with the VideoPart when the tile is clicked", () => {
    const part: VideoPart = { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "Step", mp4Url: "u" };
    const onPlay = vi.fn();
    const root = document.createElement("div");
    renderParts(root, [part], onPlay);
    (root.querySelector("button.video-card") as HTMLButtonElement).click();
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
    renderParts(root, parts, noop);
    const children = Array.from(root.children);
    expect(children[0].tagName.toLowerCase()).toBe("p");
    expect(children[1].tagName.toLowerCase()).toBe("button");
    expect(children[2].tagName.toLowerCase()).toBe("p");
    expect(children[3].tagName.toLowerCase()).toBe("button");
  });

  it("escapes text content (no HTML injection)", () => {
    const parts: Part[] = [{ kind: "text", text: "<script>alert(1)</script>" }];
    const root = document.createElement("div");
    renderParts(root, parts, noop);
    expect(root.innerHTML).not.toContain("<script>");
    expect(root.querySelector("p")?.textContent).toBe("<script>alert(1)</script>");
  });
});
