// tests/unit/fx.test.ts
import { describe, it, expect, vi } from "vitest";
import { createFx } from "../../src/fx.js";
import type { RunnerEvent } from "../../src/types.js";

function makeFakePage(measureResult: { x: number; y: number; width: number; height: number } | null = { x: 100, y: 200, width: 50, height: 20 }) {
  const calls: { fn: string; args: unknown[] }[] = [];
  // fx now resolves targets through Playwright's locator engine: cursorTo/measure
  // via `.first().boundingBox()`, highlight/zoom via `.first().elementHandle()`.
  // A null measureResult models a selector that matches nothing.
  const handle = measureResult ? { dispose: vi.fn(async () => {}) } : null;
  const page = {
    evaluate: vi.fn(async (fn: any, ...args: any[]) => {
      calls.push({ fn: String(fn), args });
      return undefined;
    }),
    waitForTimeout: vi.fn(async () => {}),
    locator: vi.fn(() => ({
      first: () => ({
        boundingBox: vi.fn(async () => measureResult),
        elementHandle: vi.fn(async () => handle),
      }),
      pressSequentially: vi.fn(async () => {}),
    })),
  } as any;
  return { page, calls };
}

describe("fx.cursorTo", () => {
  it("measures the target then issues moveCursor with the center coords", async () => {
    const { page } = makeFakePage({ x: 100, y: 200, width: 40, height: 20 });
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 1234);
    await fx.cursorTo("button.primary", "primary button", { duration: 0.5 });
    // The target is resolved via Playwright's locator (supports text=/:has-text());
    // the cursor move is still issued in-page via __daymo.moveCursor.
    expect(page.locator).toHaveBeenCalledWith("button.primary");
    const calls = (page.evaluate as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((c: string) => c.includes("__daymo.moveCursor"))).toBe(true);
  });

  it("emits an fx event with method=cursorTo and the original args", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 999);
    await fx.cursorTo("button.primary", "primary button", { duration: 0.5 });
    const fxEvent = events.find((e) => e.kind === "fx" && e.method === "cursorTo");
    expect(fxEvent).toBeDefined();
    expect((fxEvent as any).args[0]).toBe("button.primary");
    expect((fxEvent as any).args[1]).toBe("primary button");
    expect((fxEvent as any).t).toBe(999);
  });

  it("throws a clear error when the selector misses", async () => {
    const { page } = makeFakePage(null);
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await expect(fx.cursorTo("does-not-exist", "missing")).rejects.toThrow(/selector .* not found/i);
  });

  it("throws when description is missing or empty", async () => {
    const { page } = makeFakePage();
    const fx = createFx(page, [], () => 0);
    await expect(fx.cursorTo("button", "")).rejects.toThrow(/requires a description/);
    await expect((fx.cursorTo as any)("button")).rejects.toThrow(/requires a description/);
  });
});

describe("fx.typeWithDelay", () => {
  it("delegates to playwright's pressSequentially with a per-char delay", async () => {
    const { page } = makeFakePage();
    const press = vi.fn(async () => {});
    page.locator = vi.fn(() => ({ pressSequentially: press }));
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.typeWithDelay("input", "hi", 5); // 5 chars per second -> 200ms delay
    expect(page.locator).toHaveBeenCalledWith("input");
    expect(press).toHaveBeenCalledWith("hi", { delay: 200 });
  });

  it("emits an fx event", async () => {
    const { page } = makeFakePage();
    page.locator = vi.fn(() => ({ pressSequentially: vi.fn(async () => {}) }));
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 42);
    await fx.typeWithDelay("input", "hi");
    expect(events.find((e) => e.kind === "fx" && e.method === "typeWithDelay")).toBeDefined();
  });
});

describe("fx.pause", () => {
  it("waits the given seconds and emits an event", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.pause(0.1);
    expect((page.waitForTimeout as any).mock.calls[0][0]).toBe(100);
    expect(events.find((e) => e.kind === "fx" && e.method === "pause")).toBeDefined();
  });
});

describe("fx.highlight", () => {
  it("calls __daymo.highlight with selector, durationMs, and optional color", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.highlight("button", "primary button", { duration: 1.5, color: "#22c55e" });
    const evalCalls = (page.evaluate as any).mock.calls;
    const highlightCall = evalCalls.find((c: any[]) => String(c[0]).includes("__daymo.highlight"));
    expect(highlightCall).toBeDefined();
    const [, args] = highlightCall;
    // The resolved element handle is passed (not a selector string) so Playwright
    // text/xpath selectors work in-page.
    expect(args.el).toBeDefined();
    expect(args.durationMs).toBe(1500);
    expect(args.color).toBe("#22c55e");
    const ev = events.find((e) => e.kind === "fx" && e.method === "highlight");
    expect(ev).toBeDefined();
    expect((ev as any).args[1]).toBe("primary button");
  });

  it("defaults duration to 1s when not provided and passes null color", async () => {
    const { page } = makeFakePage();
    const fx = createFx(page, [], () => 0);
    await fx.highlight("button", "primary button");
    const evalCalls = (page.evaluate as any).mock.calls;
    const args = evalCalls.find((c: any[]) => String(c[0]).includes("__daymo.highlight"))[1];
    expect(args.durationMs).toBe(1000);
    expect(args.color).toBeNull();
  });

  it("throws when description is missing", async () => {
    const { page } = makeFakePage();
    const fx = createFx(page, [], () => 0);
    await expect(fx.highlight("button", "")).rejects.toThrow(/requires a description/);
  });

  it("resolves Playwright text selectors via the locator engine (regression)", async () => {
    // :has-text() is a Playwright pseudo, invalid for document.querySelector.
    // The fix routes resolution through page.locator() so it works for cursor +
    // highlight, not just page.click — these demos are the common case.
    const { page } = makeFakePage();
    const fx = createFx(page, [], () => 0);
    await fx.highlight("button:has-text('New Course')", "the New Course button");
    expect(page.locator).toHaveBeenCalledWith("button:has-text('New Course')");
  });
});

describe("fx.click", () => {
  it("invokes page.click and emits an fx event with the description", async () => {
    const { page } = makeFakePage();
    const click = vi.fn(async () => {});
    page.click = click;
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 555);
    await fx.click("a.cta", "clicking the call-to-action button");
    expect(click).toHaveBeenCalledWith("a.cta", {});
    const ev = events.find((e) => e.kind === "fx" && e.method === "click");
    expect(ev).toBeDefined();
    expect((ev as any).args[0]).toBe("a.cta");
    expect((ev as any).args[1]).toBe("clicking the call-to-action button");
  });

  it("throws when description is missing", async () => {
    const { page } = makeFakePage();
    page.click = vi.fn(async () => {});
    const fx = createFx(page, [], () => 0);
    await expect(fx.click("a.cta", "")).rejects.toThrow(/requires a description/);
  });
});

describe("fx.callout", () => {
  it("calls __daymo.callout and emits an event with target metadata", async () => {
    const { page } = makeFakePage({ x: 0, y: 0, width: 10, height: 10 });
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.callout("Hi", "h1", 2);
    const calls = (page.evaluate as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((c: string) => c.includes("__daymo.callout"))).toBe(true);
    expect(events.find((e) => e.kind === "fx" && e.method === "callout")).toBeDefined();
  });
});

describe("fx.zoom", () => {
  it("calls __daymo.zoom and emits an event", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.zoom("section.hero", 1.5, 1);
    const calls = (page.evaluate as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((c: string) => c.includes("__daymo.zoom"))).toBe(true);
    expect(events.find((e) => e.kind === "fx" && e.method === "zoom")).toBeDefined();
  });
});

describe("fx check mode", () => {
  it("cursorTo/highlight/zoom assert the selector resolves but draw nothing", async () => {
    for (const run of [
      (fx: any) => fx.cursorTo("button", "a button"),
      (fx: any) => fx.highlight("button", "a button"),
      (fx: any) => fx.zoom("button"),
    ]) {
      const { page } = makeFakePage();
      const fx = createFx(page, [], () => 0, undefined, undefined, "check");
      await run(fx);
      // The selector was resolved via the locator engine…
      expect(page.locator).toHaveBeenCalledWith("button");
      // …but no in-page __daymo.* draw was issued.
      expect(page.evaluate).not.toHaveBeenCalled();
    }
  });

  it("cursorTo/highlight/zoom throw a selector-tagged error when the selector misses", async () => {
    for (const run of [
      (fx: any) => fx.cursorTo("ghost", "x"),
      (fx: any) => fx.highlight("ghost", "x"),
      (fx: any) => fx.zoom("ghost"),
    ]) {
      const { page } = makeFakePage(null);
      const fx = createFx(page, [], () => 0, undefined, undefined, "check");
      await expect(run(fx)).rejects.toThrow(/selector not found: ghost/);
      // The error carries the selector so `daymo check` need not parse the message.
      const err = await run(fx).catch((e: any) => e);
      expect(err.selector).toBe("ghost");
    }
  });

  it("zoom with no selector is a no-op (full-page zoom) and never throws", async () => {
    const { page } = makeFakePage(null);
    const fx = createFx(page, [], () => 0, undefined, undefined, "check");
    await expect(fx.zoom()).resolves.toBeUndefined();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("say returns without throwing even with no sayCtx", async () => {
    const { page } = makeFakePage();
    const fx = createFx(page, [], () => 0, undefined, undefined, "check");
    await expect(fx.say("narration that has no audio in check mode")).resolves.toBeUndefined();
  });

  it("pause is capped to 100ms", async () => {
    const { page } = makeFakePage();
    const fx = createFx(page, [], () => 0, undefined, undefined, "check");
    await fx.pause(5);
    expect((page.waitForTimeout as any).mock.calls[0][0]).toBe(100);
  });

  it("typeWithDelay types with zero delay", async () => {
    const { page } = makeFakePage();
    const press = vi.fn(async () => {});
    page.locator = vi.fn(() => ({ pressSequentially: press }));
    const fx = createFx(page, [], () => 0, undefined, undefined, "check");
    await fx.typeWithDelay("input", "hi", 5);
    expect(press).toHaveBeenCalledWith("hi", { delay: 0 });
  });
});

describe("fx.step", () => {
  it("emits a step event with stepIndex and description", async () => {
    const events: RunnerEvent[] = [];
    const fakePage = { evaluate: async () => {} } as any;
    const fx = createFx(fakePage, events, () => 42, undefined, {
      sceneIndex: 3,
      nextStepIndex: () => 1,
    });
    await fx.step("Open the dialog");
    expect(events).toEqual([
      { kind: "step", t: 42, sceneIndex: 3, stepIndex: 1, description: "Open the dialog" },
    ]);
  });
});
