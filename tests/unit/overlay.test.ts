// tests/unit/overlay.test.ts
import { describe, it, expect } from "vitest";
import { OVERLAY_INIT_SCRIPT } from "../../src/overlay.js";

describe("overlay init script", () => {
  it("defines window.__daymo with the expected methods", () => {
    const win: any = {
      document: {
        createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }),
        createElementNS: () => ({ setAttribute: () => {}, style: {}, innerHTML: "" }),
        body: { appendChild: () => {} },
        head: { appendChild: () => {} },
      },
      requestAnimationFrame: (cb: () => void) => { cb(); return 0; },
      setTimeout: () => 0,
    };
    const fn = new Function("window", "document", "requestAnimationFrame", "setTimeout", `${OVERLAY_INIT_SCRIPT}; return window.__daymo;`);
    const api = fn(win, win.document, win.requestAnimationFrame, win.setTimeout);
    expect(api).toBeDefined();
    for (const method of ["moveCursor", "callout", "highlight", "zoom", "measure", "showCaption", "hideCaption"]) {
      expect(typeof api[method]).toBe("function");
    }
  });
});
