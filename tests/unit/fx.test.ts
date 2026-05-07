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

describe("fx.fastForward", () => {
  it("emits start + end markers around the callback", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    let now = 1000;
    const fx = createFx(page, events, () => now);
    await fx.fastForward(async () => { now += 500; }, 4);
    const kinds = events.map(e => e.kind);
    expect(kinds).toContain("fast_forward_start");
    expect(kinds).toContain("fast_forward_end");
    const start = events.find(e => e.kind === "fast_forward_start") as any;
    expect(start.factor).toBe(4);
  });

  it("emits end marker even when the callback throws", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await expect(
      fx.fastForward(async () => { throw new Error("boom"); }, 2),
    ).rejects.toThrow("boom");
    const kinds = events.map(e => e.kind);
    expect(kinds).toEqual(["fast_forward_start", "fast_forward_end"]);
  });

  it("defaults factor to 3", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.fastForward(async () => { /* noop */ });
    const start = events.find(e => e.kind === "fast_forward_start") as any;
    expect(start.factor).toBe(3);
  });

  it("clamps factor to upper bound 16", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.fastForward(async () => {}, 100);
    const start = events.find(e => e.kind === "fast_forward_start") as any;
    expect(start.factor).toBe(16);
  });

  it("clamps factor to lower bound 1.5", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.fastForward(async () => {}, 0.5);
    const start = events.find(e => e.kind === "fast_forward_start") as any;
    expect(start.factor).toBe(1.5);
  });

  it("returns the callback's resolved value", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    const result = await fx.fastForward(async () => "done");
    expect(result).toBe("done");
  });

  it("emits sceneIndex: -1 in markers (controller back-fills)", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.fastForward(async () => {});
    const start = events.find(e => e.kind === "fast_forward_start") as any;
    const end = events.find(e => e.kind === "fast_forward_end") as any;
    expect(start.sceneIndex).toBe(-1);
    expect(end.sceneIndex).toBe(-1);
  });
});

describe("fx.skip", () => {
  it("emits skip_start and skip_end around the callback", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.skip(async () => {});
    expect(events.map(e => e.kind)).toEqual(["skip_start", "skip_end"]);
  });

  it("emits skip_end on throw", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await expect(fx.skip(async () => { throw new Error("x"); })).rejects.toThrow();
    expect(events.map(e => e.kind)).toEqual(["skip_start", "skip_end"]);
  });

  it("emits sceneIndex: -1 in markers (controller back-fills)", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.skip(async () => {});
    const start = events.find(e => e.kind === "skip_start") as any;
    const end = events.find(e => e.kind === "skip_end") as any;
    expect(start.sceneIndex).toBe(-1);
    expect(end.sceneIndex).toBe(-1);
  });

  it("returns the callback's resolved value", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    const result = await fx.skip(async () => 42);
    expect(result).toBe(42);
  });
});

describe("fx marker nesting", () => {
  it("rejects fastForward inside fastForward", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await expect(
      fx.fastForward(async () => { await fx.fastForward(async () => {}); }),
    ).rejects.toThrow(/cannot be nested/i);
  });

  it("rejects skip inside fastForward", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await expect(
      fx.fastForward(async () => { await fx.skip(async () => {}); }),
    ).rejects.toThrow(/cannot be nested/i);
  });

  it("rejects fastForward inside skip", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await expect(
      fx.skip(async () => { await fx.fastForward(async () => {}); }),
    ).rejects.toThrow(/cannot be nested/i);
  });

  it("rejects skip inside skip", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await expect(
      fx.skip(async () => { await fx.skip(async () => {}); }),
    ).rejects.toThrow(/cannot be nested/i);
  });

  it("releases the lock after a successful call so subsequent calls work", async () => {
    const { page } = makeFakePage();
    const events: RunnerEvent[] = [];
    const fx = createFx(page, events, () => 0);
    await fx.fastForward(async () => {});
    await fx.skip(async () => {});           // should not throw
    expect(events.filter(e => e.kind === "fast_forward_start")).toHaveLength(1);
    expect(events.filter(e => e.kind === "skip_start")).toHaveLength(1);
  });
});
