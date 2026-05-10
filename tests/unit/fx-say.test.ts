import { describe, it, expect } from "vitest";
import { createFx } from "../../src/fx.js";

describe("fx.say", () => {
  it("emits a 'say' event with computed hash and pre-known duration", async () => {
    const events: any[] = [];
    let now = 0;
    const calls: any[] = [];

    const fakePage = {
      evaluate: async (_fn: any, args: any) => {
        calls.push(args);
        // Simulate page-side wait of durationMs by advancing the clock.
        now += args.durationMs;
      },
      locator: () => { throw new Error("not used"); },
      waitForTimeout: async () => {},
    } as any;

    const fx = createFx(fakePage, events, () => now, {
      sayTable: { abc123: { durationMs: 1500, words: [{ word: "hi", startMs: 0, endMs: 1500 }] } },
      sayHashFor: (text: string) => (text === "hi" ? "abc123" : null),
    });

    await fx.say("hi");

    const sayEvent = events.find((e) => e.kind === "say");
    expect(sayEvent).toMatchObject({
      kind: "say",
      hash: "abc123",
      text: "hi",
      durationMs: 1500,
    });
    expect(calls[0].hash).toBe("abc123");
  });

  it("throws if text was not pre-synthesized", async () => {
    const fx = createFx({} as any, [], () => 0, { sayTable: {}, sayHashFor: () => null });
    await expect(fx.say("nope")).rejects.toThrow(/not pre-synthesized/);
  });

  it("throws clearly if no sayContext was provided", async () => {
    const fx = createFx({} as any, [], () => 0);
    await expect(fx.say("anything")).rejects.toThrow(/not available/);
  });
});

describe("fx.banner / fx.hideBanner", () => {
  it("banner() invokes __daymo.banner(text, durationMs, title) and emits an 'fx' event", async () => {
    const events: any[] = [];
    let pageArgs: any = null;
    const fakePage = {
      evaluate: async (_fn: any, args: any) => { pageArgs = args; },
    } as any;
    const fx = createFx(fakePage, events, () => 1000);
    await fx.banner("Step 1", { duration: 2.5, title: "Intro" });
    expect(pageArgs).toMatchObject({ text: "Step 1", durationMs: 2500, title: "Intro" });
    const ev = events.find((e) => e.kind === "fx" && e.method === "banner");
    expect(ev).toBeDefined();
  });

  it("hideBanner() invokes __daymo.hideBanner() and emits an 'fx' event", async () => {
    const events: any[] = [];
    let called = false;
    const fakePage = {
      evaluate: async (_fn: any, _args?: any) => { called = true; },
    } as any;
    const fx = createFx(fakePage, events, () => 0);
    await fx.hideBanner();
    expect(called).toBe(true);
    expect(events.find((e) => e.kind === "fx" && e.method === "hideBanner")).toBeDefined();
  });
});
