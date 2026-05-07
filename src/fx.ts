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

    async zoom() { throw new Error("zoom: not yet implemented"); },
    async pause() { throw new Error("pause: not yet implemented"); },
    async callout() { throw new Error("callout: not yet implemented"); },
    async highlight() { throw new Error("highlight: not yet implemented"); },
  };
}
