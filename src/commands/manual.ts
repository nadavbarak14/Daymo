import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { emitManual } from "../core/manual.js";

export interface ManualFlags {
  out?: string;
  stdout?: boolean;
}

export async function manualCommand(file: string, flags: ManualFlags): Promise<void> {
  const demoFile = path.resolve(file);
  const src = await fs.readFile(demoFile, "utf8");
  const { markdown, warnings } = emitManual(parse(src));

  for (const w of warnings) {
    process.stderr.write(`warning: line ${w.line}: ${w.detail}\n`);
  }

  if (flags.stdout) {
    process.stdout.write(markdown);
    return;
  }

  const outPath = flags.out
    ? path.resolve(flags.out)
    : path.join(path.dirname(demoFile), "manual.md");
  await fs.writeFile(outPath, markdown);
  process.stdout.write(`${outPath}\n`);
}
