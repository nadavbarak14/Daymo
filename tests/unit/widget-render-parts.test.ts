// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderParts } from "../../widget/src/render-parts.js";
import type { Part } from "../../widget/src/types.js";

describe("renderParts", () => {
  it("renders a TextPart as a paragraph with the text content", () => {
    const parts: Part[] = [{ kind: "text", text: "Hello world." }];
    const root = document.createElement("div");
    renderParts(root, parts);
    expect(root.querySelector("p")?.textContent).toBe("Hello world.");
  });

  it("renders a VideoPart as a <video> element with #t= media fragment", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1500, endMs: 3500, caption: "Open dialog", mp4Url: "https://x/d.mp4" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts);
    const v = root.querySelector("video")!;
    expect(v.src).toBe("https://x/d.mp4#t=1.5,3.5");
    expect(v.getAttribute("preload")).toBe("metadata");
    expect(v.getAttribute("playsinline")).not.toBeNull();
    expect(v.hasAttribute("controls")).toBe(true);
  });

  it("renders the caption under the video", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 1000, caption: "Loomly · Open · 0:00-0:01", mp4Url: "x" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts);
    expect(root.querySelector(".caption")?.textContent).toBe("Loomly · Open · 0:00-0:01");
  });

  it("renders multiple parts in order", () => {
    const parts: Part[] = [
      { kind: "text", text: "First:" },
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 1000, caption: "c1", mp4Url: "u1" },
      { kind: "text", text: "Then:" },
      { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 0, endMs: 1000, caption: "c2", mp4Url: "u2" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts);
    const children = Array.from(root.children);
    expect(children[0].tagName.toLowerCase()).toBe("p");
    expect(children[1].tagName.toLowerCase()).toBe("div"); // video-wrap
    expect(children[2].tagName.toLowerCase()).toBe("p");
    expect(children[3].tagName.toLowerCase()).toBe("div");
  });

  it("escapes text content (no HTML injection)", () => {
    const parts: Part[] = [{ kind: "text", text: "<script>alert(1)</script>" }];
    const root = document.createElement("div");
    renderParts(root, parts);
    expect(root.innerHTML).not.toContain("<script>");
    expect(root.querySelector("p")?.textContent).toBe("<script>alert(1)</script>");
  });
});
