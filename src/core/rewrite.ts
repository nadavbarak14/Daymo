import fs from "node:fs/promises";
import { parse } from "../parser.js";
import type { SourceSpan } from "../types.js";

export function rewriteSceneProse(source: string, sceneIndex: number, newProse: string): string {
  const ast = parse(source);
  if (sceneIndex < 0 || sceneIndex >= ast.scenes.length) {
    throw new Error(`scene index ${sceneIndex} out of range`);
  }
  const lines = source.split("\n");
  const scene = ast.scenes[sceneIndex];
  const headingLine = scene.sourceLine - 1;

  // Find prose start: first non-blank line after the heading.
  let proseStart = headingLine + 1;
  while (proseStart < lines.length && lines[proseStart].trim() === "") proseStart++;

  // Find prose end: line before the first fence or scene break or next heading.
  let proseEnd = proseStart;
  while (proseEnd < lines.length) {
    const l = lines[proseEnd];
    if (/^```/.test(l) || l.trim() === "---" || /^#\s/.test(l)) break;
    proseEnd++;
  }
  while (proseEnd > proseStart && lines[proseEnd - 1].trim() === "") proseEnd--;

  const before = lines.slice(0, proseStart);
  const after = lines.slice(proseEnd);
  const proseLines = newProse.replace(/\r\n/g, "\n").split("\n");
  const next = [...before, ...proseLines, ...after].join("\n");

  const newAst = parse(next);
  if (newAst.scenes.length !== ast.scenes.length) {
    throw new Error(`rewrite changed scene count (${ast.scenes.length} → ${newAst.scenes.length})`);
  }
  return next;
}

/**
 * Replace the byte range [span.start, span.end) in `file` with a JSON-encoded
 * form of `newText`. Atomic write via temp file + rename.
 *
 * The span is expected to point at a string literal including its surrounding
 * quotes, so JSON.stringify produces a balanced replacement with no fix-up.
 */
export async function rewriteLiteralAt(
  file: string,
  span: SourceSpan,
  newText: string,
): Promise<void> {
  const original = await fs.readFile(file, "utf8");
  if (span.start < 0 || span.end > original.length || span.end < span.start) {
    throw new Error(`rewriteLiteralAt: span out of range [${span.start}, ${span.end}) for file size ${original.length}`);
  }
  const encoded = JSON.stringify(newText);
  const next = original.slice(0, span.start) + encoded + original.slice(span.end);
  const tmp = file + ".tmp." + process.pid + "." + Date.now();
  await fs.writeFile(tmp, next);
  await fs.rename(tmp, file);
}
