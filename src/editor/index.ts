import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { reduce, loadState, saveState } from "./state.js";
import type { EditorState } from "./types.js";
import { startServer, type ServerHandle } from "./server.js";
import { SseBus } from "./sse.js";
import { CaptureQueue } from "./capture.js";
import { rewriteSceneProse } from "./script-rewrite.js";
import { rewriteLiteralAt } from "../core/rewrite.js";
import { stitch } from "./stitch.js";
import { Watcher } from "./watcher.js";

/** Read `kind:"step"` events from a per-scene events.json and align them with
 *  the parsed steps array. steps[0] is the implicit preamble (always t=0); the
 *  Nth step event maps to steps[N]. */
async function readStepTimes(eventsPath: string, stepCount: number): Promise<number[]> {
  const raw = await fs.readFile(eventsPath, "utf8");
  const events: Array<{ kind: string; t: number }> = JSON.parse(raw);
  const stepEvents = events.filter((e) => e.kind === "step").map((e) => e.t);
  const out: number[] = new Array(stepCount).fill(0);
  for (let i = 1; i < stepCount && i - 1 < stepEvents.length; i++) {
    out[i] = stepEvents[i - 1];
  }
  return out;
}

export interface StartEditorOpts {
  demoFile: string;
  port?: number;
  uiDir?: string;
}

export interface EditorHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export async function startEditor(opts: StartEditorOpts): Promise<EditorHandle> {
  const demoFile = path.resolve(opts.demoFile);
  const dotDir = path.join(path.dirname(demoFile), ".daymo");
  const stateFile = path.join(dotDir, "state.json");
  const capturesDir = path.join(dotDir, "captures");

  const sse = new SseBus();
  const readAst = async () => parse(await fs.readFile(demoFile, "utf8"));
  let ast = await readAst();
  let state: EditorState = await loadState(stateFile, ast.scenes, demoFile);

  // For scenes already captured from a previous session, hydrate stepTimes
  // from their events.json so seek-to-step works without re-capturing.
  for (let i = 0; i < state.scenes.length; i++) {
    const row = state.scenes[i];
    if (row.state === "captured" && row.eventsPath && !row.stepTimes) {
      try {
        const t = await readStepTimes(row.eventsPath, row.steps.length);
        state = reduce(state, { type: "step-times", sceneIndex: i, stepTimes: t });
      } catch {}
    }
  }

  const queue = new CaptureQueue({
    getAst: () => ast,
    capturesDir,
    demoFile,
    sse,
    onDone: (i, webm, events) => {
      state = reduce(state, { type: "capture-done", sceneIndex: i, webmPath: webm, eventsPath: events });
      void saveState(stateFile, state);
      void (async () => {
        try {
          const t = await readStepTimes(events, state.scenes[i].steps.length);
          state = reduce(state, { type: "step-times", sceneIndex: i, stepTimes: t });
          sse.publish({ type: "state", state });
        } catch {}
      })();
    },
    onError: (i, msg) => {
      state = reduce(state, { type: "capture-error", sceneIndex: i, message: msg });
    },
  });

  const stepsKey = (steps: import("../types.js").Step[]) =>
    steps.map((s) => `${s.description ?? ""}|${s.says.map((x) => x.text).join("§")}|${s.banners.map((x) => x.text).join("§")}`).join("¶");

  const watcher = new Watcher({
    paths: [demoFile],
    debounceMs: 100,
    onChange: async () => {
      const newAst = await readAst();
      if (newAst.scenes.length !== state.scenes.length) {
        state = reduce(state, { type: "scenes-replaced", scenes: newAst.scenes });
      } else {
        for (let i = 0; i < state.scenes.length; i++) {
          const oldRow = state.scenes[i];
          const newScene = newAst.scenes[i];
          const changed =
            newScene.sourceLine !== oldRow.sourceLine ||
            newScene.prose !== oldRow.prose ||
            newScene.title !== oldRow.title ||
            stepsKey(newScene.steps) !== stepsKey(oldRow.steps);
          if (changed) {
            state = reduce(state, { type: "scene-changed", sceneIndex: i });
          }
        }
        // Even if no captures are invalidated, refresh the row payloads
        // so the UI sees new step content.
        state = {
          ...state,
          scenes: state.scenes.map((row, i) => ({ ...row, steps: newAst.scenes[i].steps, title: newAst.scenes[i].title, prose: newAst.scenes[i].prose })),
        };
      }
      ast = newAst;
      void saveState(stateFile, state);
      sse.publish({ type: "demo-changed" });
      sse.publish({ type: "state", state });
    },
  });
  await watcher.start();

  const rewriteProse = async (i: number, prose: string) => {
    const src = await fs.readFile(demoFile, "utf8");
    const next = rewriteSceneProse(src, i, prose);
    watcher.suppressNext();
    await fs.writeFile(demoFile, next);
    ast = await readAst();
    state = reduce(state, { type: "scene-changed", sceneIndex: i });
    void saveState(stateFile, state);
    sse.publish({ type: "state", state });
  };

  const rewriteStep = async (
    sceneIndex: number,
    stepIndex: number,
    kind: "description" | "say" | "banner" | "type",
    text: string,
    typeIndex?: number,
  ) => {
    const scene = ast.scenes[sceneIndex];
    if (!scene) throw new Error(`scene ${sceneIndex} out of range`);
    const step = scene.steps[stepIndex];
    if (!step) throw new Error(`step ${stepIndex} out of range in scene ${sceneIndex}`);
    let span: import("../types.js").SourceSpan | undefined;
    if (kind === "description") {
      if (!step.descriptionSpan) {
        throw new Error("cannot edit preamble description — add an explicit fx.step() call first");
      }
      span = step.descriptionSpan;
    } else if (kind === "say") {
      if (step.says.length === 0) {
        throw new Error("step has no fx.say to edit");
      }
      span = step.says[0].span;
    } else if (kind === "banner") {
      if (step.banners.length === 0) {
        throw new Error("step has no fx.banner to edit");
      }
      span = step.banners[0].span;
    } else {
      const idx = typeIndex ?? 0;
      if (step.types.length === 0) {
        throw new Error("step has no fx.typeWithDelay to edit");
      }
      if (idx < 0 || idx >= step.types.length) {
        throw new Error(`type index ${idx} out of range (step has ${step.types.length})`);
      }
      span = step.types[idx].span;
    }
    watcher.suppressNext();
    await rewriteLiteralAt(demoFile, span!, text);
    ast = await readAst();
    state = reduce(state, { type: "scene-changed", sceneIndex });
    // refresh row payloads so UI sees new literals
    state = {
      ...state,
      scenes: state.scenes.map((row, i) => ({ ...row, steps: ast.scenes[i].steps, title: ast.scenes[i].title, prose: ast.scenes[i].prose })),
    };
    void saveState(stateFile, state);
    sse.publish({ type: "state", state });
  };

  const stitchNow = async () => {
    const ttsDir = path.join(dotDir, "tts");
    const scenes: import("../core/stitch.js").SceneInput[] = [];
    for (const r of state.scenes) {
      let sayEvents: import("../core/scene-audio.js").SayEvent[] = [];
      let recordingOffsetMs = 0;
      if (r.eventsPath) {
        try {
          const raw = await fs.readFile(r.eventsPath, "utf8");
          const events: any[] = JSON.parse(raw);
          sayEvents = events
            .filter((e: any) => e.kind === "say")
            .map((e: any) => ({ hash: e.hash, t: e.t, durationMs: e.durationMs, words: e.words ?? [] }));
          const sceneStart = events.find((e: any) => e.kind === "scene_start");
          if (sceneStart && typeof sceneStart.recordingOffsetMs === "number") {
            recordingOffsetMs = sceneStart.recordingOffsetMs;
          }
        } catch {}
      }
      scenes.push({ webm: r.webmPath!, sayEvents, recordingOffsetMs });
    }
    const baseDir = path.dirname(demoFile);
    const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
    const out = path.join(baseDir, "output.mp4");
    sse.publish({ type: "stitch-start", sceneCount: scenes.length });
    try {
      await stitch({
        scenes,
        music,
        output: out,
        workDir: dotDir,
        ttsDir,
        musicDuck: ast.frontmatter.tts.music_duck,
        onLine: (l: string) => sse.publish({ type: "stitch-progress", line: l }),
      });
    } catch (e) {
      sse.publish({ type: "stitch-error", message: (e as Error).message });
      throw e;
    }
    sse.publish({ type: "stitch-done", output: out });
    return out;
  };

  const srv: ServerHandle = await startServer({
    port: opts.port ?? 0,
    sse,
    getState: () => state,
    enqueueCapture: (i) => queue.enqueue(i),
    rewriteProse,
    rewriteStep,
    stitchNow,
    uiDir: opts.uiDir,
    capturesDir,
  });

  return {
    url: srv.url,
    port: srv.port,
    stop: async () => {
      await srv.stop();
      await queue.whenIdle();
      await watcher.stop();
      await saveState(stateFile, state);
    },
  };
}
