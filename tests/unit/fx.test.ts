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
