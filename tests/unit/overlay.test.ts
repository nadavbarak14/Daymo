// tests/unit/overlay.test.ts
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { OVERLAY_INIT_SCRIPT } from "../../src/overlay.js";

describe("overlay init script", () => {
  it("defines window.__daymo with the expected methods", () => {
    const win: any = {
      document: {
        createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }),
        createElementNS: () => ({ setAttribute: () => {}, style: {}, innerHTML: "" }),
        body: { appendChild: () => {} },
        head: { appendChild: () => {} },
        addEventListener: () => {},
      },
      requestAnimationFrame: (cb: () => void) => { cb(); return 0; },
      setTimeout: () => 0,
      performance: { now: () => 0 },
    };
    const fn = new Function("window", "document", "requestAnimationFrame", "setTimeout", "performance", `${OVERLAY_INIT_SCRIPT}; return window.__daymo;`);
    const api = fn(win, win.document, win.requestAnimationFrame, win.setTimeout, win.performance);
    expect(api).toBeDefined();
    for (const method of ["moveCursor", "callout", "highlight", "zoom", "measure", "showCaption", "hideCaption"]) {
      expect(typeof api[method]).toBe("function");
    }
  });
});

function setupOverlay() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { runScripts: "dangerously" });
  const win = dom.window as unknown as Window & typeof globalThis & { __daymo: any };
  // jsdom 29 does not implement requestAnimationFrame; polyfill it on the
  // JSDOM window so the init script's animation loops resolve in tests.
  if (typeof (dom.window as any).requestAnimationFrame !== "function") {
    (dom.window as any).requestAnimationFrame = (cb: (t: number) => void) =>
      (dom.window as any).setTimeout(() => cb(dom.window.performance.now()), 16);
    (dom.window as any).cancelAnimationFrame = (id: any) => (dom.window as any).clearTimeout(id);
  }
  // Inject the init script as a <script> tag so it runs inside the JSDOM window
  // context with full DOM, performance.now, requestAnimationFrame access.
  const script = dom.window.document.createElement("script");
  script.textContent = OVERLAY_INIT_SCRIPT;
  dom.window.document.head.appendChild(script);
  return { dom, win, document: win.document };
}

describe("overlay banner", () => {
  it("exposes banner + hideBanner; does not expose say (moved to ffmpeg)", () => {
    const { win } = setupOverlay();
    expect(typeof win.__daymo.banner).toBe("function");
    expect(typeof win.__daymo.hideBanner).toBe("function");
    // Karaoke subtitles are burned in at stitch time, not in the browser —
    // this exposure is what guarantees coupling with the audio track.
    expect(win.__daymo.say).toBeUndefined();
    expect(win.__daymo.sayTable).toBeUndefined();
  });

  it("banner() mounts a [data-daymo-banner] element with the text + title", () => {
    const { win, document } = setupOverlay();
    win.__daymo.banner("Step 1", 0, "INTRO");
    const banner = document.querySelector("[data-daymo-banner]") as HTMLElement | null;
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("Step 1");
    expect(banner!.textContent).toContain("INTRO");
  });

  it("banner() with durationMs auto-hides", async () => {
    const { win, document } = setupOverlay();
    win.__daymo.banner("X", 50);
    const banner = document.querySelector("[data-daymo-banner]") as HTMLElement;
    await new Promise((r) => setTimeout(r, 100));
    expect(banner.style.opacity).toBe("0");
  });

  it("hideBanner() sets opacity 0 immediately", () => {
    const { win, document } = setupOverlay();
    win.__daymo.banner("X");
    win.__daymo.hideBanner();
    const banner = document.querySelector("[data-daymo-banner]") as HTMLElement;
    expect(banner.style.opacity).toBe("0");
  });
});
