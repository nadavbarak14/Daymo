// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "../../widget/src/mount.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Intercept attachShadow to capture the (closed) shadow root before mount
 *  gets it.  Returns a cleanup function that restores the original. */
function captureShadow(): { getShadow: () => ShadowRoot | null; restore: () => void } {
  let captured: ShadowRoot | null = null;
  const orig = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = orig.call(this, init);
    captured = root;
    return root;
  };
  return {
    getShadow: () => captured,
    restore: () => { Element.prototype.attachShadow = orig; },
  };
}

/** Stub global.fetch with a minimal handler for getConfig (404) and chat (answer). */
function stubGlobalFetch(videoPart: {
  stepId: string;
  demoId: string;
  startMs: number;
  endMs: number;
  mp4Url: string;
  caption: string;
}) {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (String(url).includes("widget-config")) {
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => null }, text: async () => "" });
    }
    // chat → answer with one video part
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        kind: "answer",
        parts: [
          { kind: "text", text: "Here is how:" },
          { kind: "video", ...videoPart },
        ],
      }),
    });
  }));
}

/** Track paused/playing state on a specific video element instance.
 *  Works alongside the prototype-level play/pause stubs from beforeEach. */
function trackPauseState(video: HTMLVideoElement) {
  const state = { paused: true };
  // Override on the instance (wins over prototype)
  vi.spyOn(video, "play").mockImplementation(() => {
    state.paused = false;
    return Promise.resolve();
  });
  vi.spyOn(video, "pause").mockImplementation(() => {
    state.paused = true;
  });
  Object.defineProperty(video, "paused", { get: () => state.paused, configurable: true });
  return state;
}

/** Fire a timeupdate event with the given currentTime on the video element. */
function fireTimeUpdate(video: HTMLVideoElement, currentTime: number) {
  Object.defineProperty(video, "currentTime", { value: currentTime, writable: true, configurable: true });
  video.dispatchEvent(new Event("timeupdate"));
}

/** Fire a seeking event on the video element. */
function fireSeeking(video: HTMLVideoElement) {
  video.dispatchEvent(new Event("seeking"));
}

/** Submit a question to the widget input and wait for the answer to render. */
async function askQuestion(shadow: ShadowRoot, question = "How do I do it?") {
  const input = shadow.querySelector(".dw-input") as HTMLInputElement | null;
  if (!input) throw new Error("input not found");
  input.value = question;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  // Wait for the async fetch + state update to complete
  await new Promise((r) => setTimeout(r, 50));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("widget lightbox — soft pause", () => {
  const videoPart = {
    stepId: "d:0:1",
    demoId: "d",
    startMs: 3000,
    endMs: 8000,
    mp4Url: "https://cdn.example.com/d.mp4",
    caption: "Open dialog",
  };

  let restoreAttachShadow: (() => void) | null = null;

  beforeEach(() => {
    // jsdom's HTMLMediaElement.play() returns undefined; stub it globally so
    // openLightbox's .play().catch(...) doesn't throw.
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => { /* noop */ });
  });

  afterEach(() => {
    restoreAttachShadow?.();
    restoreAttachShadow = null;
    // Clean up widget root
    document.getElementById("daymo-widget-root")?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mountAndOpenLightbox() {
    const { getShadow, restore } = captureShadow();
    restoreAttachShadow = restore;

    stubGlobalFetch(videoPart);
    // mount() is async (awaits getConfig), wait for it
    await mount({ widgetId: "w", baseUrl: "https://daymo.dev" });

    const shadow = getShadow()!;
    expect(shadow).not.toBeNull();

    // Open the panel by clicking the bubble
    const bubble = shadow.querySelector(".dw-bubble") as HTMLButtonElement;
    bubble.click();
    await new Promise((r) => setTimeout(r, 10));

    // Ask a question — triggers the chat call and renders the video card
    await askQuestion(shadow);

    // Click the video card tile to open the lightbox
    const card = shadow.querySelector("button.dw-video-card") as HTMLButtonElement | null;
    expect(card).not.toBeNull();
    card!.click();
    await new Promise((r) => setTimeout(r, 10));

    const lightboxVideo = shadow.querySelector(".dw-lb-inner video") as HTMLVideoElement | null;
    expect(lightboxVideo).not.toBeNull();

    return { shadow, lightboxVideo: lightboxVideo! };
  }

  it("assertion 1: timeupdate past soft stop → video paused once and .dw-lb-keep visible", async () => {
    const { shadow, lightboxVideo } = await mountAndOpenLightbox();
    const paused = trackPauseState(lightboxVideo);

    // Fire timeupdate exactly at the end of the referenced range
    fireTimeUpdate(lightboxVideo, 8.0); // endMs=8000 → 8s

    expect(paused.paused).toBe(true); // paused
    const keepBtn = shadow.querySelector(".dw-lb-keep") as HTMLElement | null;
    expect(keepBtn).not.toBeNull();
    expect(keepBtn!.style.display).toBe(""); // visible (reset to default, not "none")
  });

  it("assertion 2: clicking .dw-lb-keep then another timeupdate past stop → NOT paused again (one-shot)", async () => {
    const { shadow, lightboxVideo } = await mountAndOpenLightbox();
    const paused = trackPauseState(lightboxVideo);

    // Trigger the first soft stop
    fireTimeUpdate(lightboxVideo, 8.5);
    expect(paused.paused).toBe(true);

    // Click "Keep watching" — should call play()
    const keepBtn = shadow.querySelector(".dw-lb-keep") as HTMLButtonElement;
    keepBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(paused.paused).toBe(false); // resumed

    // Fire play event so keepWatchingBtn hides
    lightboxVideo.dispatchEvent(new Event("play"));
    expect(keepBtn.style.display).toBe("none");

    // A second timeupdate past the same threshold: soft stop was already fired (one-shot = null)
    // so it must NOT pause again — regression for the old sticky-clip bug
    fireTimeUpdate(lightboxVideo, 9.0);
    expect(paused.paused).toBe(false); // still playing
  });

  it("assertion 3: user seeking before soft stop → soft stop cleared; subsequent timeupdate does not pause", async () => {
    const { shadow: _shadow, lightboxVideo } = await mountAndOpenLightbox();
    const paused = trackPauseState(lightboxVideo);

    // Simulate the video playing (so we can observe whether pause() is called)
    await lightboxVideo.play(); // sets paused.paused = false
    expect(paused.paused).toBe(false);

    // openLightbox sets lightboxProgrammaticSeek=true then sets currentTime.
    // In jsdom, setting currentTime does NOT auto-fire seeking, so the flag
    // is still true.  Consume it with one seeking event (simulates the
    // programmatic seek), then fire a second one to simulate a real user drag.
    fireSeeking(lightboxVideo); // consumes programmatic flag (no-op for softStop)
    fireSeeking(lightboxVideo); // now treated as a user seek → clears softStop

    // timeupdate past the stop point: should NOT pause now
    fireTimeUpdate(lightboxVideo, 10.0);
    expect(paused.paused).toBe(false); // still playing — soft stop was cleared
  });
});
