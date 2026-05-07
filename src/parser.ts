// src/parser.ts
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import type { DemoAst, Frontmatter, OverlayDirective, Scene } from "./types.js";

export const VALID_TRANSITIONS = [
  "crossfade",
  "dip-to-black",
  "slide-left",
  "slide-right",
  "none",
] as const;

export const VALID_CAPTURE_MODES = ["continuous", "per-scene"] as const;

export function parse(source: string): DemoAst {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(source);
  } catch (e) {
    throw new Error(`failed to parse frontmatter: ${(e as Error).message}`);
  }
  const frontmatter = parsed.data as Frontmatter;
  if (!frontmatter.title || !frontmatter.url) {
    throw new Error("missing or incomplete frontmatter (need `title` and `url`)");
  }

  if (
    frontmatter.defaultTransition !== undefined &&
    !VALID_TRANSITIONS.includes(frontmatter.defaultTransition as any)
  ) {
    throw new Error(
      `unknown defaultTransition "${frontmatter.defaultTransition}" — must be one of ${VALID_TRANSITIONS.join(", ")}`,
    );
  }

  if (
    frontmatter.captureMode !== undefined &&
    !VALID_CAPTURE_MODES.includes(frontmatter.captureMode as any)
  ) {
    throw new Error(
      `unknown captureMode "${frontmatter.captureMode}" — must be one of ${VALID_CAPTURE_MODES.join(", ")}`,
    );
  }

  // Compute the line offset where post-frontmatter content begins.
  const allLines = source.split("\n");
  let contentStartLine = 0;
  let delims = 0;
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i] === "---") {
      delims++;
      if (delims === 2) {
        contentStartLine = i + 1;
        break;
      }
    }
  }

  const sceneChunks = splitOnFenceAwareDelimiter(parsed.content);
  const scenes: Scene[] = [];
  let runningOffset = contentStartLine;
  for (const chunk of sceneChunks) {
    const chunkLines = chunk.split("\n").length;
    const trimmed = chunk.trim();
    if (!trimmed) {
      runningOffset += chunkLines;
      continue;
    }
    scenes.push(parseScene(chunk, runningOffset));
    runningOffset += chunkLines;
  }

  if (scenes.length === 0) {
    throw new Error("no scenes found");
  }
  return { frontmatter, scenes };
}

/**
 * Split content on lines that are exactly "---", but ignore "---" lines that
 * appear inside fenced code blocks.
 */
function splitOnFenceAwareDelimiter(content: string): string[] {
  const lines = content.split("\n");
  const out: string[][] = [[]];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence && line === "---") {
      out.push([]);
    } else {
      out[out.length - 1].push(line);
    }
  }
  return out.map((arr) => arr.join("\n"));
}

function parseScene(chunk: string, baseLine: number): Scene {
  const lines = chunk.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const headingMatch = lines[i]?.match(/^# (.+)$/);
  if (!headingMatch) {
    throw new Error(`scene at line ${baseLine + i + 1} has no heading`);
  }
  const title = headingMatch[1].trim();
  const sourceLine = baseLine + i + 1;
  i++;

  const proseLines: string[] = [];
  let playwrightCode: Scene["playwrightCode"];
  const overlays: OverlayDirective[] = [];

  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^```(\w+)?\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? "";
      const fenceStartLine = baseLine + i + 1;
      i++;
      const body: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i >= lines.length) {
        throw new Error(`unterminated code fence starting at line ${fenceStartLine}`);
      }
      i++;
      if (lang === "playwright") {
        playwrightCode = { code: body.join("\n"), sourceLine: fenceStartLine };
      } else if (lang === "overlay") {
        const directive = parseYaml(body.join("\n")) as OverlayDirective;
        if (!directive || typeof directive !== "object" || !directive.type) {
          throw new Error(`overlay block at line ${fenceStartLine} missing \`type\``);
        }
        overlays.push(directive);
      }
    } else {
      proseLines.push(lines[i]);
      i++;
    }
  }

  return {
    sourceLine,
    title,
    prose: proseLines.join("\n").trim(),
    playwrightCode,
    overlays,
  };
}
