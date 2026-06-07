// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { createPlayer } from "../../../src/help-center/player.js";
import { DEFAULT_STRINGS } from "../../../src/help-center/strings.js";
import type { ManifestDemo } from "../../../src/publish/types.js";

const demo: ManifestDemo = {
  demoId: "d",
  title: "Create a note",
  description: "How to create",
  durationMs: 90000,
  videoUrl: "https://cdn/help/v1/d/output.mp4",
  posterUrl: "https://cdn/help/v1/d/poster.jpg",
  steps: [
    { stepId: "d:0:1", label: "Open the editor", startMs: 0 },
    { stepId: "d:0:2", label: "Click new note", startMs: 30000 },
  ],
};

beforeAll(() => {
  // jsdom has no media pipeline. Back currentTime with a field and fire
  // `seeking` on assignment (matching browser behavior); stub play/pause.
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
    configurable: true,
    get() {
      return (this as unknown as { __ct?: number }).__ct ?? 0;
    },
    set(v: number) {
      (this as unknown as { __ct?: number }).__ct = v;
      this.dispatchEvent(new Event("seeking"));
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get() {
      return (this as unknown as { __rs?: number }).__rs ?? 0;
    },
  });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

/** Advance the fake playhead WITHOUT firing `seeking` (i.e., playback, not a
 *  seek), then emit timeupdate — mirrors how browsers report progress. */
function playTo(video: HTMLVideoElement, seconds: number) {
  (video as unknown as { __ct: number }).__ct = seconds;
  video.dispatchEvent(new Event("timeupdate"));
}

function setMetadataLoaded(video: HTMLVideoElement) {
  (video as unknown as { __rs: number }).__rs = 1;
  video.dispatchEvent(new Event("loadedmetadata"));
}

describe("createPlayer", () => {
  it("open() renders the dialog with title, steps, video src, scroll lock and focus", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);

    const modal = document.body.querySelector(".daymo-help-modal")!;
    expect(modal.classList.contains("open")).toBe(true);
    expect(modal.querySelector(".daymo-help-player")?.getAttribute("role")).toBe("dialog");
    expect(modal.textContent).toContain("Create a note");
    expect(modal.textContent).toContain("Open the editor");
    expect(modal.textContent).toContain("0:30"); // step 2 timestamp
    const video = modal.querySelector("video")!;
    expect(video.src).toContain("/d/output.mp4");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement?.classList.contains("daymo-help-player-close")).toBe(true);
  });

  it("clip cue waits for metadata, seeks, and auto-pauses at endMs", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo, { startMs: 30000, endMs: 40000, autoplay: true });
    const video = document.body.querySelector("video")!;
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    expect(video.currentTime).toBe(0); // metadata not loaded yet
    setMetadataLoaded(video);
    expect(video.currentTime).toBe(30);

    playTo(video, 35);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    playTo(video, 40.1);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    // one-shot: playing past it again does not pause again
    playTo(video, 50);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  });

  it("a user seek clears the endMs stop; the programmatic cue seek does not", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo, { startMs: 30000, endMs: 40000 });
    const video = document.body.querySelector("video")!;
    setMetadataLoaded(video); // fires the programmatic cue seek (seeking event)

    // user drags the native scrubber
    video.currentTime = 10;
    playTo(video, 41);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("step click seeks and the active step tracks timeupdate", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    const video = document.body.querySelector("video")!;
    setMetadataLoaded(video);

    const steps = document.body.querySelectorAll<HTMLButtonElement>(".daymo-help-step");
    expect(steps).toHaveLength(2);
    steps[1].click();
    expect(video.currentTime).toBe(30);
    playTo(video, 31);
    expect(steps[1].classList.contains("active")).toBe(true);
    expect(steps[0].classList.contains("active")).toBe(false);
  });

  it("step click clears a pending endMs stop", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo, { startMs: 0, endMs: 20000 });
    const video = document.body.querySelector("video")!;
    setMetadataLoaded(video);
    document.body.querySelectorAll<HTMLButtonElement>(".daymo-help-step")[1].click();
    playTo(video, 45);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("re-open before metadata loads cancels the previous pending cue seek", () => {
    const other: ManifestDemo = { ...demo, demoId: "e", title: "Other", videoUrl: "https://cdn/e.mp4" };
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo, { startMs: 30000, endMs: 40000 });
    player.open(other); // metadata for the first never loaded
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    const video = document.body.querySelector("video")!;
    setMetadataLoaded(video);
    expect(video.currentTime).toBe(0); // stale 30s seek must NOT fire
    playTo(video, 41);
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled(); // stale endMs gone too
  });

  it("Escape closes: pauses, unlocks scroll, restores focus to the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    const modal = document.body.querySelector(".daymo-help-modal")!;
    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(modal.classList.contains("open")).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
  });

  it("backdrop click closes; clicks inside the dialog do not", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    const modal = document.body.querySelector<HTMLElement>(".daymo-help-modal")!;
    modal.querySelector<HTMLElement>(".daymo-help-player-title")!.click();
    expect(modal.classList.contains("open")).toBe(true);
    modal.click(); // event.target === modal
    expect(modal.classList.contains("open")).toBe(false);
  });

  it("Tab is trapped inside the dialog", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    const modal = document.body.querySelector<HTMLElement>(".daymo-help-modal")!;
    const steps = modal.querySelectorAll<HTMLButtonElement>(".daymo-help-step");
    const last = steps[steps.length - 1];
    last.focus();
    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement?.classList.contains("daymo-help-player-close")).toBe(true);
    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
  });

  it("destroy() closes (restoring body state) and removes the modal", () => {
    const player = createPlayer(document, DEFAULT_STRINGS);
    player.open(demo);
    player.destroy();
    expect(document.body.querySelector(".daymo-help-modal")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});
