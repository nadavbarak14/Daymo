// src/fx.ts
import type { Page } from "playwright";
import type { BBox, DemoFx, RunnerEvent, WordTiming } from "./types.js";

export type Clock = () => number;

export interface SayContext {
  /** map of pre-synthesized hash → { durationMs, words } */
  sayTable: Record<string, { durationMs: number; words: WordTiming[] }>;
  /** lookup hash for a literal text — returns null if not pre-synthesized */
  sayHashFor: (text: string) => string | null;
}

export interface StepContext {
  /** Position of the current scene in the AST scenes array (0-based). */
  sceneIndex: number;
  /** Returns the index that should be assigned to the next fx.step call.
   *  Implementation is expected to increment its own counter. */
  nextStepIndex: () => number;
}

export type FxMode = "capture" | "check";

export function createFx(
  page: Page,
  events: RunnerEvent[],
  clock: Clock,
  sayCtx?: SayContext,
  stepCtx?: StepContext,
  mode: FxMode = "capture",
): DemoFx {
  const check = mode === "check";

  function emit(method: string, args: unknown[]) {
    events.push({ kind: "fx", t: clock(), method, args });
  }

  // Resolve a target through Playwright's locator engine so demos can use the
  // full selector syntax (text=, :has-text(), role=, xpath=, …) — not just the
  // CSS subset document.querySelector understands. `.first()` keeps it
  // forgiving when a selector matches more than one node.
  async function measure(selector: string): Promise<BBox> {
    const bbox = await page.locator(selector).first().boundingBox();
    if (!bbox) throw new Error(`fx: selector "${selector}" not found`);
    return bbox;
  }

  // An error tagged with the failing selector so `daymo check` can report it
  // without parsing the message.
  function notFound(selector: string): Error {
    const e = new Error(`selector not found: ${selector}`);
    (e as { selector?: string }).selector = selector;
    return e;
  }

  // Check-mode liveness assertion: resolve a selector and throw a tagged
  // `notFound` if it doesn't resolve — whether the engine returns null (absent /
  // not visible) or throws a TimeoutError (never appeared). Either way, for a CI
  // canary the script is broken. `via: "box"` requires a visible bounding box
  // (cursorTo's contract); `via: "handle"` only requires the element to exist
  // (highlight/zoom).
  async function assertResolves(selector: string, via: "box" | "handle"): Promise<void> {
    try {
      const loc = page.locator(selector).first();
      if (via === "box") {
        if (!(await loc.boundingBox())) throw notFound(selector);
      } else {
        const handle = await loc.elementHandle();
        if (!handle) throw notFound(selector);
        await handle.dispose();
      }
    } catch (e) {
      if ((e as { selector?: string }).selector) throw e; // already tagged
      throw notFound(selector); // timeout / other resolution failure → missing
    }
  }

  return {
    async cursorTo(selector, description, opts) {
      if (typeof description !== "string" || description.length === 0) {
        throw new Error(`fx.cursorTo("${selector}", ...) requires a description as the 2nd arg`);
      }
      emit("cursorTo", [selector, description, opts]);
      if (check) {
        // Liveness only: cursorTo needs a visible box at capture time, so assert
        // a bounding box resolves; skip the in-page cursor draw.
        await assertResolves(selector, "box");
        return;
      }
      const bbox = await measure(selector);
      const x = bbox.x + bbox.width / 2;
      const y = bbox.y + bbox.height / 2;
      const durationMs = (opts?.duration ?? 0.4) * 1000;
      await page.evaluate(
        ({ x, y, durationMs }) => (window as any).__daymo.moveCursor(x, y, durationMs),
        { x, y, durationMs },
      );
      await page.waitForTimeout(durationMs);
    },

    async typeWithDelay(selector, text, cps = 12) {
      emit("typeWithDelay", [selector, text, cps]);
      // No artificial per-char delay when checking — we only care that the
      // field accepts input, not the cinematic typing speed.
      const delay = check ? 0 : Math.round(1000 / cps);
      await page.locator(selector).pressSequentially(text, { delay });
    },

    async zoom(selector, factor = 1.5, duration = 0.5) {
      emit("zoom", [selector, factor, duration]);
      if (check) {
        // A null handle normally means "full-page zoom" — but if the author DID
        // name a selector, a null handle means it broke, so assert it resolves.
        if (selector) await assertResolves(selector, "handle");
        return;
      }
      const durationMs = duration * 1000;
      // Resolve via locator (null = full-page zoom) so text/xpath selectors work.
      const handle = selector
        ? await page.locator(selector).first().elementHandle()
        : null;
      await page.evaluate(
        ({ el, factor, durationMs }) =>
          (window as any).__daymo.zoom(el, factor, durationMs),
        { el: handle, factor, durationMs },
      );
      await handle?.dispose();
      await page.waitForTimeout(durationMs);
    },

    async pause(seconds) {
      emit("pause", [seconds]);
      // Pauses are purely cinematic; cap them hard when checking so a demo full
      // of `fx.pause(2)` doesn't make CI crawl.
      await page.waitForTimeout(check ? Math.min(seconds * 1000, 100) : seconds * 1000);
    },

    async callout(text, target, duration = 2) {
      emit("callout", [text, target, duration]);
      const durationMs = duration * 1000;
      await page.evaluate(
        ({ text, target, durationMs }) =>
          (window as any).__daymo.callout(text, target, durationMs),
        { text, target, durationMs },
      );
    },

    async highlight(selector, description, opts) {
      if (typeof description !== "string" || description.length === 0) {
        throw new Error(`fx.highlight("${selector}", ...) requires a description as the 2nd arg`);
      }
      emit("highlight", [selector, description, opts]);
      if (check) {
        await assertResolves(selector, "handle");
        return;
      }
      const durationMs = (opts?.duration ?? 1) * 1000;
      const color = opts?.color ?? null;
      const handle = await page.locator(selector).first().elementHandle();
      if (!handle) throw new Error(`fx.highlight: selector "${selector}" not found`);
      await page.evaluate(
        ({ el, durationMs, color }) =>
          (window as any).__daymo.highlight(el, durationMs, color),
        { el: handle, durationMs, color },
      );
      await handle.dispose();
    },

    async click(selector, description, opts) {
      if (typeof description !== "string" || description.length === 0) {
        throw new Error(`fx.click("${selector}", ...) requires a description as the 2nd arg`);
      }
      emit("click", [selector, description, opts]);
      await page.click(selector, opts ?? {});
    },

    async say(text, _opts) {
      // No narration when checking — there's no recording to attach audio to.
      if (check) return;
      if (!sayCtx) throw new Error("fx.say is not available outside of capture");
      const hash = sayCtx.sayHashFor(text);
      if (!hash) {
        throw new Error(`fx.say: text not pre-synthesized: "${text.slice(0, 60)}"`);
      }
      const entry = sayCtx.sayTable[hash];
      if (!entry) throw new Error(`fx.say: missing sayTable entry for hash ${hash}`);
      // Capture-time: just record the event and reserve the duration on the
      // recording. Audio + per-word karaoke subtitles are burned in by ffmpeg
      // at stitch time from this same event — so the audio offset and the
      // subtitle offset come from a single source (ev.t) and cannot drift.
      events.push({
        kind: "say",
        t: clock(),
        hash,
        text,
        durationMs: entry.durationMs,
        words: entry.words,
      });
      await page.waitForTimeout(entry.durationMs);
    },

    async banner(text, opts) {
      emit("banner", [text, opts]);
      const durationMs = opts?.duration !== undefined ? opts.duration * 1000 : 0;
      await page.evaluate(
        ({ text, durationMs, title }) => (window as any).__daymo.banner(text, durationMs, title),
        { text, durationMs, title: opts?.title ?? "" },
      );
    },

    async hideBanner() {
      emit("hideBanner", []);
      await page.evaluate(() => (window as any).__daymo.hideBanner());
    },

    async waitForSelector(selector, opts) {
      emit("waitForSelector", [selector, opts]);
      await page.waitForSelector(selector, opts ?? {});
    },

    async waitForLoadState(state = "load") {
      emit("waitForLoadState", [state]);
      await page.waitForLoadState(state);
    },

    async waitForURL(url, opts) {
      emit("waitForURL", [String(url), opts]);
      await page.waitForURL(url as string | RegExp, opts);
    },

    async step(description) {
      if (!stepCtx) {
        // Outside of a capture context (e.g. dry runs) — silently no-op.
        return;
      }
      events.push({
        kind: "step",
        t: clock(),
        sceneIndex: stepCtx.sceneIndex,
        stepIndex: stepCtx.nextStepIndex(),
        description,
      });
    },
  };
}
