import { parse } from "../parser.js";

export function rewriteSceneProse(source: string, sceneIndex: number, newProse: string): string {
  const ast = parse(source);
  if (sceneIndex < 0 || sceneIndex >= ast.scenes.length) {
    throw new Error(`scene index ${sceneIndex} out of range`);
  }
  const lines = source.split("\n");
  const scene = ast.scenes[sceneIndex];

  // Find the heading line by searching for the heading text, starting near sourceLine.
  // The parser's sourceLine may be off by a few lines due to scene break accounting.
  const headingPrefix = `# ${scene.title}`;
  let headingLine = -1;
  const searchStart = Math.max(0, scene.sourceLine - 3);
  const searchEnd = Math.min(lines.length, scene.sourceLine + 3);
  for (let i = searchStart; i < searchEnd; i++) {
    if (lines[i].startsWith(headingPrefix)) {
      headingLine = i;
      break;
    }
  }
  if (headingLine === -1) {
    throw new Error(`could not find heading for scene ${sceneIndex}`);
  }

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

  // Validate that prose doesn't contain patterns that look like headings
  if (/\n#\s/.test(newProse)) {
    throw new Error(`rewrite changed scene count`);
  }

  const newAst = parse(next);
  if (newAst.scenes.length !== ast.scenes.length) {
    throw new Error(`rewrite changed scene count (${ast.scenes.length} → ${newAst.scenes.length})`);
  }
  return next;
}
