import { describe, it, expect } from "vitest";
import { createFx } from "../../src/fx.js";

describe("fx.say", () => {
  it("emits a 'say' event with hash + duration + word timings, reserves duration on the recording", async () => {
    const events: any[] = [];
    const evaluateCalls: any[] = [];
    const waitCalls: number[] = [];
    const fakePage = {
      // fx.say must NOT call into the browser — karaoke is burned in at
      // stitch time. Any page.evaluate here would re-introduce the drift bug.
      evaluate: async (_fn: any, args: any) => { evaluateCalls.push(args); },
      locator: () => { throw new Error("not used"); },
      waitForTimeout: async (ms: number) => { waitCalls.push(ms); },
    } as any;

    const words = [
      { word: "hi", startMs: 0, endMs: 600 },
      { word: "there", startMs: 600, endMs: 1500 },
    ];
    const fx = createFx(fakePage, events, () => 7000, {
      sayTable: { abc123: { durationMs: 1500, words } },
      sayHashFor: (text: string) => (text === "hi there" ? "abc123" : null),
    });

    await fx.say("hi there");

    const sayEvent = events.find((e) => e.kind === "say");
    expect(sayEvent).toMatchObject({
      kind: "say",
      t: 7000,
      hash: "abc123",
      text: "hi there",
      durationMs: 1500,
    });
    // words[] is the single source of truth for stitch-time subtitle karaoke
    expect(sayEvent.words).toEqual(words);
    expect(waitCalls).toEqual([1500]);
    expect(evaluateCalls).toEqual([]);
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

describe("fx.waitForSelector / waitForLoadState / waitForURL", () => {
  it("waitForSelector delegates to page.waitForSelector and emits an 'fx' event", async () => {
    const events: any[] = [];
    const calls: any[] = [];
    const fakePage = {
      waitForSelector: async (sel: string, opts: any) => { calls.push({ sel, opts }); },
    } as any;
    const fx = createFx(fakePage, events, () => 100);
    await fx.waitForSelector(".main", { state: "visible" });
    expect(calls).toEqual([{ sel: ".main", opts: { state: "visible" } }]);
    const ev = events.find((e) => e.kind === "fx" && e.method === "waitForSelector");
    expect(ev).toBeDefined();
  });

  it("waitForLoadState defaults to 'load' and delegates", async () => {
    const events: any[] = [];
    const states: string[] = [];
    const fakePage = {
      waitForLoadState: async (s: string) => { states.push(s); },
    } as any;
    const fx = createFx(fakePage, events, () => 0);
    await fx.waitForLoadState();
    await fx.waitForLoadState("networkidle");
    expect(states).toEqual(["load", "networkidle"]);
    expect(events.filter((e) => e.kind === "fx" && e.method === "waitForLoadState")).toHaveLength(2);
  });

  it("waitForURL delegates and emits", async () => {
    const events: any[] = [];
    const urls: any[] = [];
    const fakePage = {
      waitForURL: async (u: any, opts: any) => { urls.push({ u, opts }); },
    } as any;
    const fx = createFx(fakePage, events, () => 0);
    await fx.waitForURL("/dashboard");
    await fx.waitForURL(/item\?id=\d+/, { timeout: 5000 });
    expect(urls).toHaveLength(2);
    expect(urls[0].u).toBe("/dashboard");
    expect(urls[1].u).toBeInstanceOf(RegExp);
    expect(events.filter((e) => e.kind === "fx" && e.method === "waitForURL")).toHaveLength(2);
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
