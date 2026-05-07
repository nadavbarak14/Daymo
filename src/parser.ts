// src/parser.ts
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import type { CaptureMode, DemoAst, Frontmatter, OverlayDirective, Scene, SceneOverrides, SlateConfig, TransitionConfig, TransitionType } from "./types.js";

export const VALID_TRANSITIONS = [
  "crossfade",
  "dip-to-black",
  "slide-left",
  "slide-right",
  "none",
] as const;

export const VALID_CAPTURE_MODES = ["continuous", "per-scene"] as const;

/**
 * Canonical duration helper for .demo fenced blocks. Accepts "0.5s",
 * "500ms", or a bare number (treated as ms). Returns milliseconds.
 * Tasks 5 (slates) and 18 (compositor) should import this rather
 * than adding their own variants.
 */
export function parseDurationMs(s: string | number | undefined | null, defaultMs: number): number {
  if (s === undefined || s === null || s === "") return defaultMs;
  if (typeof s === "number") {
    if (!Number.isFinite(s)) throw new Error(`invalid duration ${s}`);
    return s;
  }
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*(ms|s)?$/.exec(s.trim());
  if (!m) throw new Error(`invalid duration "${s}"`);
  const n = Number(m[1]);
  if (!Number.isFinite(n)) throw new Error(`invalid duration "${s}"`);
  return m[2] === "ms" ? n : n * 1000;
}

const DEFAULT_SLATE_BG = "#0a0a0a";
const DEFAULT_SLATE_ACCENT = "#3b82f6";

function normalizeSlate(
  raw: unknown,
  defaultDurationMs: number,
): SlateConfig | false | undefined {
  if (raw === undefined) return undefined;
  if (raw === false) return false;
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`intro/outro must be an object or false`);
  }
  const r = raw as Record<string, unknown>;
  return {
    durationMs: parseDurationMs(typeof r.duration === "string" || typeof r.duration === "number" ? r.duration as any : undefined, defaultDurationMs),
    background: typeof r.background === "string" ? r.background : DEFAULT_SLATE_BG,
    accent: typeof r.accent === "string" ? r.accent : DEFAULT_SLATE_ACCENT,
    logo: typeof r.logo === "string" ? r.logo : undefined,
    title: typeof r.title === "string" ? r.title : undefined,
    subtitle: typeof r.subtitle === "string" ? r.subtitle : undefined,
    text: typeof r.text === "string" ? r.text : undefined,
  };
}

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
    !VALID_TRANSITIONS.includes(frontmatter.defaultTransition)
  ) {
    throw new Error(
      `unknown defaultTransition "${frontmatter.defaultTransition}" — must be one of ${VALID_TRANSITIONS.join(", ")}`,
    );
  }

  if (
    frontmatter.captureMode !== undefined &&
    !VALID_CAPTURE_MODES.includes(frontmatter.captureMode)
  ) {
    throw new Error(
      `unknown captureMode "${frontmatter.captureMode}" — must be one of ${VALID_CAPTURE_MODES.join(", ")}`,
    );
  }

  frontmatter.intro = normalizeSlate(frontmatter.intro, 2500);
  frontmatter.outro = normalizeSlate(frontmatter.outro, 2000);

  const captureMode: CaptureMode = frontmatter.captureMode ?? "continuous";

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
    scenes.push(parseScene(chunk, runningOffset, captureMode));
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

function parseScene(chunk: string, baseLine: number, captureMode: CaptureMode): Scene {
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
  let transition: TransitionConfig | undefined;
  let sceneConfig: SceneOverrides | undefined;

  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^```([\w-]+)?\s*$/);
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
      } else if (lang === "transition") {
        const directive = parseYaml(body.join("\n")) as { type?: string; duration?: string };
        if (!directive || typeof directive !== "object" || !directive.type) {
          throw new Error(`transition block at line ${fenceStartLine} missing \`type\``);
        }
        if (!VALID_TRANSITIONS.includes(directive.type as TransitionType)) {
          throw new Error(
            `transition block at line ${fenceStartLine}: unknown type "${directive.type}" — must be one of ${VALID_TRANSITIONS.join(", ")}`,
          );
        }
        if (transition) {
          throw new Error(`scene "${title}" has more than one transition block`);
        }
        transition = {
          type: directive.type as TransitionType,
          durationMs: parseDurationMs(directive.duration, 500),
        };
      } else if (lang === "scene-config") {
        if (captureMode !== "per-scene") {
          throw new Error(
            `scene-config block at line ${fenceStartLine} is only legal when captureMode: per-scene`,
          );
        }
        const cfg = parseYaml(body.join("\n")) as SceneOverrides | null;
        if (!cfg || typeof cfg !== "object") {
          throw new Error(`scene-config block at line ${fenceStartLine} is empty`);
        }
        if (sceneConfig) {
          throw new Error(`scene "${title}" has more than one scene-config block`);
        }
        sceneConfig = cfg;
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
    transition,
    sceneConfig,
  };
}
