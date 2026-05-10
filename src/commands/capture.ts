// src/commands/capture.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { captureSingleScene } from "../core/capture.js";
import { loadState, reduce, saveState } from "../core/store.js";

export interface CaptureFlags {
  scene?: number; // 1-indexed
  all?: boolean;
}

export async function captureCommand(file: string, flags: CaptureFlags): Promise<void> {
  if (flags.scene !== undefined && flags.all) {
    throw new Error("--scene and --all are mutually exclusive");
  }
  if (flags.scene === undefined && !flags.all) {
    throw new Error("must specify --scene N or --all");
  }

  const demoFile = path.resolve(file);
  const dotDir = path.join(path.dirname(demoFile), ".daymo");
  const capturesDir = path.join(dotDir, "captures");
  const stateFile = path.join(dotDir, "state.json");
  const ast = parse(await fs.readFile(demoFile, "utf8"));

  let state = await loadState(stateFile, ast.scenes, demoFile);

  const targets: number[] = flags.all
    ? ast.scenes.map((_, i) => i)
    : [(flags.scene as number) - 1];

  for (const i of targets) {
    if (i < 0 || i >= ast.scenes.length) {
      throw new Error(`scene ${i + 1} out of range (have ${ast.scenes.length})`);
    }
    const result = await captureSingleScene(ast, i, { capturesDir, demoFile });
    state = reduce(state, {
      type: "capture-done",
      sceneIndex: i,
      webmPath: result.webm,
      eventsPath: result.events,
    });
    await saveState(stateFile, state);
    process.stdout.write(`captured scene ${i + 1}: ${result.webm}\n`);
  }
}
