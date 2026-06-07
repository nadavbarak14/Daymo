// src/core/check.ts
//
// `daymo check` core: run a demo's scenes through the real Controller with
// recording/TTS/overlays stripped (mode: "check"), asserting that every
// selector the demo touches still resolves. Produces a structured pass/fail
// result and writes nothing — the video is irrelevant, only "does the script
// still drive the app" matters.
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { Controller } from "../controller.js";
import type { RunnerEvent } from "../types.js";

export interface CheckStep {
  sceneIndex: number;
  stepIndex: number;
  /** The fx.step("...") label (sourced from the step event's `description`). */
  label: string;
}

export interface CheckFailure {
  /** The last fx.step entered before the throw, if any. */
  step?: CheckStep;
  /** The selector that failed to resolve, when the failure was a tagged fx miss. */
  selector?: string;
  message: string;
  /** Absolute path to the .demo file. */
  file: string;
  /** Source line of the failing scene's playwright block. */
  line?: number;
}

export interface CheckResult {
  /** Matches index/stitch: basename of the .demo file, extension stripped. */
  demoId: string;
  ok: boolean;
  durationMs: number;
  steps: CheckStep[];
  failure?: CheckFailure;
}

export interface CheckDemoOpts {
  /** Override the ORIGIN of each demo's frontmatter url (keeps path + query). */
  baseUrl?: string;
  /** Per-action + navigation timeout (ms). Default 15000. */
  timeoutMs?: number;
}

/** Swap the origin (protocol + host) of `frontmatterUrl` for `baseUrl`'s,
 *  keeping the frontmatter's path and query. No-op when `baseUrl` is absent. */
export function applyBaseUrl(frontmatterUrl: string, baseUrl?: string): string {
  if (!baseUrl) return frontmatterUrl;
  const u = new URL(frontmatterUrl);
  const o = new URL(baseUrl);
  u.protocol = o.protocol;
  u.host = o.host;
  return u.toString();
}

/** The sandbox rewraps scene errors in `new Error(msg, { cause })`, so an fx
 *  `notFound` error's `.selector` tag ends up nested under `.cause`. Walk the
 *  chain to recover it. */
function taggedSelector(err: unknown): string | undefined {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    const sel = (cur as { selector?: unknown }).selector;
    if (typeof sel === "string") return sel;
    seen.add(cur);
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

function stepsFrom(events: RunnerEvent[]): CheckStep[] {
  return events
    .filter((e): e is Extract<RunnerEvent, { kind: "step" }> => e.kind === "step")
    .map((e) => ({ sceneIndex: e.sceneIndex, stepIndex: e.stepIndex, label: e.description }));
}

export async function checkDemo(demoFile: string, opts: CheckDemoOpts = {}): Promise<CheckResult> {
  const resolved = path.resolve(demoFile);
  const demoId = path.basename(resolved, path.extname(resolved));
  const baseDir = path.dirname(resolved);
  const ast = parse(await fs.readFile(resolved, "utf8"));
  const url = applyBaseUrl(ast.frontmatter.url, opts.baseUrl);
  const timeout = opts.timeoutMs ?? 15000;
  const storageStatePath = ast.frontmatter.auth?.storageState
    ? path.resolve(baseDir, ast.frontmatter.auth.storageState)
    : undefined;

  const start = Date.now();
  const steps: CheckStep[] = [];

  // Each scene captures from a fresh navigation in real capture, so check mirrors
  // that with a fresh Controller per scene — same fidelity, no recording.
  for (let i = 0; i < ast.scenes.length; i++) {
    const scene = ast.scenes[i];
    const ctrl = await Controller.start({
      url,
      viewport: ast.frontmatter.viewport,
      mocks: ast.frontmatter.mocks,
      storageStatePath,
      mode: "check",
      timeout,
    });
    let failed: unknown;
    try {
      await ctrl.runScene(scene, i);
    } catch (e) {
      failed = e;
    } finally {
      await ctrl.stop();
    }
    const sceneSteps = stepsFrom(ctrl.recordedEvents);
    steps.push(...sceneSteps);
    if (failed !== undefined) {
      const selector = taggedSelector(failed);
      return {
        demoId,
        ok: false,
        durationMs: Date.now() - start,
        steps,
        failure: {
          step: sceneSteps[sceneSteps.length - 1],
          selector,
          message: (failed as Error).message,
          file: resolved,
          line: scene.playwrightCode?.sourceLine ?? scene.sourceLine,
        },
      };
    }
  }

  return { demoId, ok: true, durationMs: Date.now() - start, steps };
}
