// src/commands/set-prose.ts
import path from "node:path";
import fs from "node:fs/promises";
import { rewriteSceneProse } from "../core/rewrite.js";

export interface SetProseFlags {
  scene: number; // 1-indexed
  text: string;
}

export async function setProseCommand(file: string, flags: SetProseFlags): Promise<void> {
  const demoFile = path.resolve(file);
  const src = await fs.readFile(demoFile, "utf8");
  const next = rewriteSceneProse(src, flags.scene - 1, flags.text);
  await fs.writeFile(demoFile, next);
  process.stdout.write(`${demoFile}\n`);
}
