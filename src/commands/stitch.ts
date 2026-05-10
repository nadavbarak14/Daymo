// src/commands/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState } from "../core/store.js";
import { stitch, type SceneInput } from "../core/stitch.js";

export async function stitchCommand(file: string): Promise<void> {
  const demoFile = path.resolve(file);
  const baseDir = path.dirname(demoFile);
  const dotDir = path.join(baseDir, ".daymo");
  const stateFile = path.join(dotDir, "state.json");
  const ttsDir = path.join(dotDir, "tts");

  const ast = parse(await fs.readFile(demoFile, "utf8"));
  const state = await loadState(stateFile, ast.scenes, demoFile);

  const pending: number[] = state.scenes.flatMap((r, i) => r.state === "pending" ? [i + 1] : []);
  if (pending.length > 0) {
    throw new Error(`scenes not captured: ${pending.join(", ")} — run: daymo capture <file> --all`);
  }

  const scenes: SceneInput[] = [];
  for (const r of state.scenes) {
    let sayEvents: { hash: string; t: number }[] = [];
    if (r.eventsPath) {
      try {
        const raw = await fs.readFile(r.eventsPath, "utf8");
        const events: any[] = JSON.parse(raw);
        sayEvents = events
          .filter((e) => e.kind === "say")
          .map((e) => ({ hash: e.hash, t: e.t }));
      } catch {}
    }
    scenes.push({ webm: r.webmPath!, sayEvents });
  }

  const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  const output = path.join(baseDir, "output.mp4");

  await stitch({
    scenes,
    music,
    output,
    workDir: dotDir,
    ttsDir,
    musicDuck: ast.frontmatter.tts.music_duck,
    onLine: () => {},
  });
  process.stdout.write(`${output}\n`);
}
