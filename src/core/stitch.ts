import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { buildConcatList, buildStitchArgs } from "./concat.js";

export interface StitchOpts {
  scenePaths: string[];
  music: string | null;
  output: string;
  workDir: string;
  musicVolume?: number;
  onLine?: (line: string) => void;
}

export async function stitch(opts: StitchOpts): Promise<string> {
  const listFile = path.join(opts.workDir, "concat-list.txt");
  await fs.writeFile(listFile, buildConcatList(opts.scenePaths));
  const args = buildStitchArgs({
    listFile,
    music: opts.music,
    output: opts.output,
    musicVolume: opts.musicVolume,
  });
  const proc = execa("ffmpeg", args);
  if (opts.onLine && proc.stderr) {
    proc.stderr.setEncoding("utf8");
    let buf = "";
    proc.stderr.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) opts.onLine!(line);
    });
  }
  await proc;
  return opts.output;
}
