// src/commands/render.ts
import path from "node:path";
import { render } from "../runner.js";

export async function renderCommand(file: string, flags: { out?: string }): Promise<void> {
  const demoFile = path.resolve(file);
  console.log(`daymo: rendering ${demoFile}`);
  const { mp4Path, artifactsDir } = await render({
    demoFile,
    artifactsBase: flags.out,
  });
  console.log(`daymo: wrote ${mp4Path}`);
  console.log(`daymo: artifacts in ${artifactsDir}`);
}
