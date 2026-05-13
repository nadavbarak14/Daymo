// src/controller.ts
import path from "node:path";
import fs from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { OVERLAY_INIT_SCRIPT } from "./overlay.js";
import { attachMocks, buildRouteTable } from "./mocks.js";
import { createFx, type SayContext } from "./fx.js";
import { runSceneBlock } from "./sandbox.js";
import { computeKey } from "./tts/cache.js";
import { scanFxSayLiterals } from "./tts/scan.js";
import type { TtsProvider, WordTiming } from "./tts/provider.js";
import type { MockSourceConfig, RunnerEvent, Scene } from "./types.js";

export interface ControllerOpts {
  url: string;
  viewport?: { width: number; height: number };
  mocks?: MockSourceConfig[];
  storageStatePath?: string;
  artifactsDir: string;
  ttsProvider?: TtsProvider;
  ttsConfig?: { voice: string; rate: string };
}

function parseDurationSeconds(s: string | undefined, defaultSec: number): number {
  if (!s) return defaultSec;
  const m = /^([0-9.]+)\s*s?$/.exec(s.trim());
  return m ? Number(m[1]) : defaultSec;
}

export class Controller {
  private events: RunnerEvent[] = [];
  private startWall: number = 0;
  /** Wall time when recordVideo started capturing (= page creation, before
   *  page.goto). startWall is set AFTER goto so events `t=0` corresponds to
   *  "page is loaded". The gap between these two is the webm prefix that
   *  shows the page-load state — audio mixed at events-time would otherwise
   *  play during that prefix. Stitch trims by this offset to realign. */
  private recordingStartedWall: number = 0;

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
    // recordVideo begins capturing from page creation. Mark this moment so
    // stitch can trim the page-load prefix off the front of the webm.
    const recordingStartedWall = Date.now();
    if (opts.mocks?.length) {
      await attachMocks(page, buildRouteTable(opts.mocks));
    }
    await page.goto(opts.url);
    const ctrl = new Controller(browser, context, page, opts);
    ctrl.recordingStartedWall = recordingStartedWall;
    ctrl.startWall = Date.now();
    return ctrl;
  }

  private now(): number {
    return Date.now() - this.startWall;
  }

  async runScene(scene: Scene, sceneIndex: number): Promise<void> {
    this.events.push({
      kind: "scene_start",
      t: this.now(),
      index: scene.sourceLine,
      title: scene.title,
      prose: scene.prose,
      // Page-load prefix that stitch should trim off the front of the webm.
      recordingOffsetMs: Math.max(0, this.startWall - this.recordingStartedWall),
    });
    try {
      let sayCtx: SayContext | undefined;
      if (this.opts.ttsProvider && scene.playwrightCode) {
        // Pre-synthesize so fx.say can record durationMs + word timings into
        // the event. Audio and per-word karaoke subtitles are both rendered
        // by ffmpeg at stitch time from those events — capture itself only
        // reserves the duration on the recording. Single source of truth →
        // audio and subtitles cannot drift apart.
        const calls = scanFxSayLiterals(scene.playwrightCode.code);
        const sayTable: Record<string, { durationMs: number; words: WordTiming[] }> = {};
        const hashByText: Record<string, string> = {};
        const cfg = this.opts.ttsConfig ?? { voice: "en-US-AriaNeural", rate: "+0%" };
        await Promise.all(calls.map(async (c) => {
          const out = await this.opts.ttsProvider!.synthesize({ text: c.text, voice: cfg.voice, rate: cfg.rate });
          const hash = computeKey({ text: c.text, voice: cfg.voice, rate: cfg.rate, providerId: this.opts.ttsProvider!.id });
          const totalMs = out.timings.length ? out.timings[out.timings.length - 1].endMs : 0;
          sayTable[hash] = { durationMs: totalMs, words: out.timings };
          hashByText[c.text] = hash;
        }));
        sayCtx = {
          sayTable,
          sayHashFor: (text) => hashByText[text] ?? null,
        };
      }

      if (scene.playwrightCode) {
        let stepCounter = 0;
        const stepCtx = { sceneIndex, nextStepIndex: () => ++stepCounter };
        const fx = createFx(this.page, this.events, () => this.now(), sayCtx, stepCtx);
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
        if (directive.type === "callout" && directive.text) {
          const ms = parseDurationSeconds(directive.duration, 2) * 1000;
          await this.page.evaluate(
            ({ text, target, ms }) => (window as any).__daymo.callout(text, target, ms),
            { text: directive.text, target: directive.target, ms },
          );
        } else if (directive.type === "highlight" && directive.target) {
          const ms = parseDurationSeconds(directive.duration, 1) * 1000;
          await this.page.evaluate(
            ({ selector, ms }) => (window as any).__daymo.highlight(selector, ms),
            { selector: directive.target, ms },
          );
        }
      }
      this.events.push({ kind: "scene_end", t: this.now(), index: scene.sourceLine });
    } catch (e) {
      this.events.push({
        kind: "error",
        t: this.now(),
        message: (e as Error).message,
        sceneIndex: scene.sourceLine,
      });
      throw e;
    }
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
