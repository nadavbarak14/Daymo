import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { reduce, loadState, saveState } from "./state.js";
import type { EditorState } from "./types.js";
import { startServer, type ServerHandle } from "./server.js";
import { SseBus } from "./sse.js";
import { CaptureQueue } from "./capture.js";

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

  const srv: ServerHandle = await startServer({
    port: opts.port ?? 0,
    sse,
    getState: () => state,
    enqueueCapture: (i) => queue.enqueue(i),
  });

  return {
    url: srv.url,
    port: srv.port,
    stop: async () => { await srv.stop(); await saveState(stateFile, state); },
  };
}
