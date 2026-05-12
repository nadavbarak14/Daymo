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

export function createFx(
  page: Page,
  events: RunnerEvent[],
  clock: Clock,
  sayCtx?: SayContext,
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
    async cursorTo(selector, opts) {
      emit("cursorTo", [selector, opts]);
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

    async highlight(selector, duration = 1) {
      emit("highlight", [selector, duration]);
      const durationMs = duration * 1000;
      await page.evaluate(
        ({ selector, durationMs }) =>
          (window as any).__daymo.highlight(selector, durationMs),
        { selector, durationMs },
      );
    },

    async say(text, _opts) {
      if (!sayCtx) throw new Error("fx.say is not available outside of capture");
      const hash = sayCtx.sayHashFor(text);
      if (!hash) {
        throw new Error(`fx.say: text not pre-synthesized: "${text.slice(0, 60)}"`);
      }
      const entry = sayCtx.sayTable[hash];
      if (!entry) throw new Error(`fx.say: missing sayTable entry for hash ${hash}`);
      events.push({ kind: "say", t: clock(), hash, text, durationMs: entry.durationMs });
      await page.evaluate(
        ({ hash }) => (window as any).__daymo.say(hash),
        { hash, durationMs: entry.durationMs },
      );
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

    async step(_description) {
      throw new Error("fx.step impl pending");
    },
  };
}
