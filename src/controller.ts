// src/controller.ts
import path from "node:path";
import fs from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { OVERLAY_INIT_SCRIPT } from "./overlay.js";
import { attachMocks, buildRouteTable } from "./mocks.js";
import { createFx } from "./fx.js";
import { runSceneBlock } from "./sandbox.js";
import type { MockSourceConfig, RunnerEvent, Scene } from "./types.js";

export interface ControllerOpts {
  url: string;
  viewport?: { width: number; height: number };
  mocks?: MockSourceConfig[];
  storageStatePath?: string;
  artifactsDir: string;
}

export class Controller {
  private events: RunnerEvent[] = [];
  private startWall: number = 0;

  private constructor(
    private browser: Browser,
    private context: BrowserContext,
    public page: Page,
    private opts: ControllerOpts,
  ) {}

  static async start(opts: ControllerOpts): Promise<Controller> {
    await fs.mkdir(opts.artifactsDir, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: opts.url,
      viewport: opts.viewport ?? { width: 1440, height: 900 },
      storageState: opts.storageStatePath,
      recordVideo: { dir: opts.artifactsDir, size: opts.viewport ?? { width: 1440, height: 900 } },
    });
    await context.addInitScript({ content: OVERLAY_INIT_SCRIPT });
    const page = await context.newPage();
    if (opts.mocks?.length) {
      await attachMocks(page, buildRouteTable(opts.mocks));
    }
    await page.goto(opts.url);
    const ctrl = new Controller(browser, context, page, opts);
    ctrl.startWall = Date.now();
    return ctrl;
  }

  private now(): number {
    return Date.now() - this.startWall;
  }

  async runScene(scene: Scene): Promise<void> {
    this.events.push({
      kind: "scene_start",
      t: this.now(),
      index: scene.sourceLine,
      title: scene.title,
      prose: scene.prose,
    });
    if (scene.prose.trim()) {
      await this.page.evaluate(
        ({ title, prose }) => (window as any).__daymo.showCaption(title, prose),
        { title: scene.title, prose: scene.prose },
      );
    }
    if (scene.playwrightCode) {
      const fx = createFx(this.page, this.events, () => this.now());
      const console = {
        log: (...args: unknown[]) => this.events.push({ kind: "log", t: this.now(), level: "log", args }),
        warn: (...args: unknown[]) => this.events.push({ kind: "log", t: this.now(), level: "warn", args }),
        error: (...args: unknown[]) => this.events.push({ kind: "log", t: this.now(), level: "error", args }),
      };
      await runSceneBlock(
        { code: scene.playwrightCode.code, sourceLine: scene.playwrightCode.sourceLine, sceneTitle: scene.title },
        { page: this.page, fx, console },
      );
    }
    for (const directive of scene.overlays) {
      const bbox = directive.target
        ? ((await this.page
            .evaluate((s) => (window as any).__daymo.measure(s), directive.target)) as
            | { x: number; y: number; width: number; height: number }
            | null)
        : null;
      this.events.push({ kind: "overlay", t: this.now(), directive, bbox });
    }
    await this.page.evaluate(() => (window as any).__daymo.hideCaption());
    this.events.push({ kind: "scene_end", t: this.now(), index: scene.sourceLine });
  }

  async stop(): Promise<void> {
    await this.context.close();
    await this.browser.close();
    const files = await fs.readdir(this.opts.artifactsDir);
    const webm = files.find((f) => f.endsWith(".webm") && f !== "raw_page.webm");
    if (webm) {
      await fs.rename(
        path.join(this.opts.artifactsDir, webm),
        path.join(this.opts.artifactsDir, "raw_page.webm"),
      );
    }
    await fs.writeFile(
      path.join(this.opts.artifactsDir, "events.json"),
      JSON.stringify(this.events, null, 2),
    );
  }
}
