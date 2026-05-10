// src/commands/state.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState } from "../core/store.js";

export interface StateFlags {
  json?: boolean;
}

export async function stateCommand(file: string, flags: StateFlags): Promise<void> {
  const demoFile = path.resolve(file);
  const ast = parse(await fs.readFile(demoFile, "utf8"));
  const stateFile = path.join(path.dirname(demoFile), ".daymo", "state.json");
  const state = await loadState(stateFile, ast.scenes, demoFile);

  if (flags.json) {
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
    return;
  }

  const lines: string[] = [];
  lines.push(`# ${ast.frontmatter.title}`);
  lines.push("");
  for (let i = 0; i < state.scenes.length; i++) {
    const r = state.scenes[i];
    const tag = String(i + 1).padStart(2, " ");
    const status = r.state.padEnd(8, " ");
    lines.push(`  ${tag}  ${status}  ${r.title}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}
