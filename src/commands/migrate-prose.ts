// src/commands/migrate-prose.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";

export async function migrateProseCommand(file: string): Promise<void> {
  const demoFile = path.resolve(file);
  const src = await fs.readFile(demoFile, "utf8");
  const next = migrateProseToFxSay(src);
  await fs.writeFile(demoFile, next);
  process.stdout.write(`${demoFile}\n`);
}

export function migrateProseToFxSay(source: string): string {
  // Parse to discover scene boundaries.
  const ast = parse(source);
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  // Walk scenes from last to first to preserve line indices for earlier scenes.
  for (let i = ast.scenes.length - 1; i >= 0; i--) {
    const scene = ast.scenes[i];
    const prose = scene.prose.trim();
    if (!prose) continue;

    // Find prose start: first non-blank line after the heading
    const headingLine = scene.sourceLine - 1;
    let proseStart = headingLine + 1;
    while (proseStart < lines.length && lines[proseStart].trim() === "") proseStart++;
    let proseEnd = proseStart;
    while (proseEnd < lines.length) {
      const l = lines[proseEnd];
      if (/^```/.test(l) || l.trim() === "---" || /^#\s/.test(l)) break;
      proseEnd++;
    }
    while (proseEnd > proseStart && lines[proseEnd - 1].trim() === "") proseEnd--;

    const sayCall = `await fx.say(${JSON.stringify(prose)});`;
    const playwrightStart = scene.playwrightCode?.sourceLine; // 1-based, the fence line

    if (playwrightStart) {
      const fenceIdx = playwrightStart - 1; // 0-based
      const nextLine = lines[fenceIdx + 1] ?? "";
      // Idempotent: skip if first line in playwright block already calls fx.say with this exact text
      if (nextLine.trim() === sayCall.trim()) {
        // Remove the prose lines, keep the existing fx.say
        lines.splice(proseStart, proseEnd - proseStart);
        continue;
      }
      // Insert sayCall as the new first line of the playwright block
      lines.splice(fenceIdx + 1, 0, sayCall);
      // The prose lines now sit at unchanged 0-based indices since they're ABOVE the playwright block
      lines.splice(proseStart, proseEnd - proseStart);
    } else {
      // No playwright block — create one in-place where the prose was
      const newBlock = ["```playwright", sayCall, "```"];
      lines.splice(proseStart, proseEnd - proseStart, ...newBlock);
    }
  }

  return lines.join("\n");
}
