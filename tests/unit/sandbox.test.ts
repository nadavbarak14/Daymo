// tests/unit/sandbox.test.ts
import { describe, it, expect, vi } from "vitest";
import { runSceneBlock } from "../../src/sandbox.js";

describe("sandbox.runSceneBlock", () => {
  it("executes user code with page, fx, console", async () => {
    const page: any = { goto: vi.fn(async () => {}) };
    const fx: any = { pause: vi.fn(async () => {}) };
    const log = vi.fn();
    await runSceneBlock({
      code: 'await page.goto("/"); await fx.pause(0); console.log("hi");',
      sourceLine: 10,
      sceneTitle: "Intro",
    }, { page, fx, console: { log } as any });
    expect(page.goto).toHaveBeenCalledWith("/");
    expect(fx.pause).toHaveBeenCalledWith(0);
    expect(log).toHaveBeenCalledWith("hi");
  });

  it("wraps thrown errors with scene title and source line", async () => {
    const page: any = {};
    const fx: any = {};
    await expect(runSceneBlock({
      code: 'throw new Error("boom");',
      sourceLine: 42,
      sceneTitle: "Open dialog",
    }, { page, fx, console })).rejects.toThrow(/scene "Open dialog".*line 42.*boom/i);
  });

  it("preserves the original error as the cause", async () => {
    try {
      await runSceneBlock(
        { code: 'throw new TypeError("x");', sourceLine: 1, sceneTitle: "s" },
        { page: {} as any, fx: {} as any, console },
      );
    } catch (e) {
      expect((e as Error).cause).toBeInstanceOf(TypeError);
    }
  });
});
