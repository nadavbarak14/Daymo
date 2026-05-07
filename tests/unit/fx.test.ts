// tests/unit/fx.test.ts
import { describe, it, expect, vi } from "vitest";
import { createFx } from "../../src/fx.js";
import type { RunnerEvent } from "../../src/types.js";

function makeFakePage(measureResult: { x: number; y: number; width: number; height: number } | null = { x: 100, y: 200, width: 50, height: 20 }) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const page = {
    evaluate: vi.fn(async (fn: any, ...args: any[]) => {
      const src = String(fn);
      if (src.includes("__daymo.measure")) return measureResult;
      calls.push({ fn: src, args });
      return undefined;
    }),
    waitForTimeout: vi.fn(async () => {}),
    locator: vi.fn(() => ({ pressSequentially: vi.fn(async () => {}) })),
  } as any;
  return { page, calls };
}

describe("fx.cursorTo", () => {
  it("measures the target then issues moveCursor with the center coords", async () => {
    const { page } = makeFakePage({ x: 100, y: 200, width: 40, height: 20 });
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 1234);
    await fx.cursorTo("button.primary", { duration: 0.5 });
    const calls = (page.evaluate as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((c: string) => c.includes("__daymo.measure"))).toBe(true);
    expect(calls.some((c: string) => c.includes("__daymo.moveCursor"))).toBe(true);
  });

  it("emits an fx event with method=cursorTo and the original args", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 999);
    await fx.cursorTo("button.primary", { duration: 0.5 });
    const fxEvent = events.find((e) => e.kind === "fx" && e.method === "cursorTo");
    expect(fxEvent).toBeDefined();
    expect((fxEvent as any).args[0]).toBe("button.primary");
    expect((fxEvent as any).t).toBe(999);
  });

  it("throws a clear error when the selector misses", async () => {
    const { page } = makeFakePage(null);
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await expect(fx.cursorTo("does-not-exist")).rejects.toThrow(/selector .* not found/i);
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
  it("calls __daymo.highlight on the target and emits an event", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.highlight("button", 1.5);
    const calls = (page.evaluate as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((c: string) => c.includes("__daymo.highlight"))).toBe(true);
    expect(events.find((e) => e.kind === "fx" && e.method === "highlight")).toBeDefined();
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
