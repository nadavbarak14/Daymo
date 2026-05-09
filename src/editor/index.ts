import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState, saveState } from "./state.js";
import type { EditorState } from "./types.js";
import { startServer, type ServerHandle } from "./server.js";
import { SseBus } from "./sse.js";

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

  const source = await fs.readFile(demoFile, "utf8");
  const ast = parse(source);
  // eslint-disable-next-line prefer-const
  let state: EditorState = await loadState(stateFile, ast.scenes, demoFile);

  const sse = new SseBus();

  const srv: ServerHandle = await startServer({
    port: opts.port ?? 0,
    sse,
    getState: () => state,
  });

  return {
    url: srv.url,
    port: srv.port,
    stop: async () => { await srv.stop(); await saveState(stateFile, state); },
  };
}
