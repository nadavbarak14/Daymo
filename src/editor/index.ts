import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { reduce, loadState, saveState } from "./state.js";
import type { EditorState } from "./types.js";
import { startServer, type ServerHandle } from "./server.js";
import { SseBus } from "./sse.js";
import { CaptureQueue } from "./capture.js";
import { rewriteSceneProse } from "./script-rewrite.js";
import { stitch } from "./stitch.js";
import { Watcher } from "./watcher.js";

export interface StartEditorOpts {
  demoFile: string;
  port?: number;
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

  const queue = new CaptureQueue({
    getAst: () => ast,
    capturesDir,
    demoFile,
    sse,
    onDone: (i, webm, events) => {
      state = reduce(state, { type: "capture-done", sceneIndex: i, webmPath: webm, eventsPath: events });
      void saveState(stateFile, state);
    },
    onError: (i, msg) => {
      state = reduce(state, { type: "capture-error", sceneIndex: i, message: msg });
    },
  });

  const approve = (i: number, approved: boolean) => {
    state = reduce(state, { type: "approve", sceneIndex: i, approved });
    void saveState(stateFile, state);
    sse.publish({ type: "state", state });
  };

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
          if (newScene.sourceLine !== oldRow.sourceLine ||
              newScene.prose !== oldRow.prose ||
              newScene.title !== oldRow.title) {
            state = reduce(state, { type: "scene-changed", sceneIndex: i });
          }
        }
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
  };

  const stitchNow = async () => {
    const scenePaths = state.scenes.map((r) => r.webmPath!).filter(Boolean);
    const baseDir = path.dirname(demoFile);
    const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
    const out = path.join(baseDir, "output.mp4");
    await stitch({
      scenePaths,
      music,
      output: out,
      workDir: dotDir,
      onLine: (l) => sse.publish({ type: "stitch-progress", line: l }),
    });
    sse.publish({ type: "stitch-done", output: out });
    return out;
  };

  const srv: ServerHandle = await startServer({
    port: opts.port ?? 0,
    sse,
    getState: () => state,
    enqueueCapture: (i) => queue.enqueue(i),
    approve,
    rewriteProse,
    stitchNow,
  });

  return {
    url: srv.url,
    port: srv.port,
    stop: async () => { await srv.stop(); await watcher.stop(); await saveState(stateFile, state); },
  };
}
