// src/sandbox.ts
import type { Page } from "playwright";
import type { DemoFx } from "./types.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
  new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

export interface SceneBlock {
  code: string;
  sourceLine: number;
  sceneTitle: string;
}

export interface SceneContext {
  page: Page;
  fx: DemoFx;
  console: Pick<Console, "log" | "warn" | "error">;
}

export async function runSceneBlock(block: SceneBlock, ctx: SceneContext): Promise<void> {
  let fn: (...args: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction("page", "fx", "console", block.code);
  } catch (e) {
    throw new Error(
      `Syntax error in scene "${block.sceneTitle}" at line ${block.sourceLine}: ${(e as Error).message}`,
      { cause: e as Error },
    );
  }
  try {
    await fn(ctx.page, ctx.fx, ctx.console);
  } catch (e) {
    throw new Error(
      `Error in scene "${block.sceneTitle}" line ${block.sourceLine}: ${(e as Error).message}`,
      { cause: e as Error },
    );
  }
}
