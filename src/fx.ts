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

export function createFx(
  page: Page,
  events: RunnerEvent[],
  clock: Clock,
  sayCtx?: SayContext,
  stepCtx?: StepContext,
): DemoFx {
  function emit(method: string, args: unknown[]) {
    events.push({ kind: "fx", t: clock(), method, args });
  }

  async function measure(selector: string): Promise<BBox> {
    const bbox = (await page.evaluate(
      (s) => (window as any).__daymo.measure(s),
      selector,
    )) as BBox | null;
    if (!bbox) throw new Error(`fx: selector "${selector}" not found`);
    return bbox;
  }

  return {
    async cursorTo(selector, description, opts) {
      if (typeof description !== "string" || description.length === 0) {
        throw new Error(`fx.cursorTo("${selector}", ...) requires a description as the 2nd arg`);
      }
      emit("cursorTo", [selector, description, opts]);
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
      const delay = Math.round(1000 / cps);
      await page.locator(selector).pressSequentially(text, { delay });
    },

    async zoom(selector, factor = 1.5, duration = 0.5) {
      emit("zoom", [selector, factor, duration]);
      const durationMs = duration * 1000;
      await page.evaluate(
        ({ selector, factor, durationMs }) =>
          (window as any).__daymo.zoom(selector, factor, durationMs),
        { selector, factor, durationMs },
      );
      await page.waitForTimeout(durationMs);
    },

    async pause(seconds) {
      emit("pause", [seconds]);
      await page.waitForTimeout(seconds * 1000);
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
      const durationMs = (opts?.duration ?? 1) * 1000;
      const color = opts?.color ?? null;
      await page.evaluate(
        ({ selector, durationMs, color }) =>
          (window as any).__daymo.highlight(selector, durationMs, color),
        { selector, durationMs, color },
      );
    },

    async click(selector, description, opts) {
      if (typeof description !== "string" || description.length === 0) {
        throw new Error(`fx.click("${selector}", ...) requires a description as the 2nd arg`);
      }
      emit("click", [selector, description, opts]);
      await page.click(selector, opts ?? {});
    },

    async say(text, _opts) {
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
