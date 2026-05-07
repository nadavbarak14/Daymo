// src/fx.ts
import type { Page } from "playwright";
import type { BBox, DemoFx, RunnerEvent } from "./types.js";

export type Clock = () => number;

export function createFx(page: Page, events: RunnerEvent[], clock: Clock): DemoFx {
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

  const FF_MIN = 1.5;
  const FF_MAX = 16;
  let activeMarker: "fast_forward" | "skip" | null = null;

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

    async fastForward<T>(fn: () => Promise<T>, factor = 3): Promise<T> {
      if (activeMarker) {
        throw new Error(`fx.fastForward cannot be nested inside fx.${activeMarker}`);
      }
      const clamped = Math.max(FF_MIN, Math.min(FF_MAX, factor));
      events.push({ kind: "fast_forward_start", t: clock(), sceneIndex: -1, factor: clamped });
      activeMarker = "fast_forward";
      try {
        return await fn();
      } finally {
        events.push({ kind: "fast_forward_end", t: clock(), sceneIndex: -1 });
        activeMarker = null;
      }
    },

    async skip<T>(fn: () => Promise<T>): Promise<T> {
      if (activeMarker) {
        throw new Error(`fx.skip cannot be nested inside fx.${activeMarker}`);
      }
      events.push({ kind: "skip_start", t: clock(), sceneIndex: -1 });
      activeMarker = "skip";
      try {
        return await fn();
      } finally {
        events.push({ kind: "skip_end", t: clock(), sceneIndex: -1 });
        activeMarker = null;
      }
    },
  };
}
