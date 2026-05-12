// src/parser.ts
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { scanStepEvents } from "./tts/scan.js";
import type { DemoAst, Frontmatter, OverlayDirective, Scene, Step } from "./types.js";

export function parse(source: string): DemoAst {
  source = source.replace(/\r\n/g, "\n");
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(source);
  } catch (e) {
    throw new Error(`failed to parse frontmatter: ${(e as Error).message}`);
  }
  const rawTts = (parsed.data as any).tts ?? {};
  const frontmatter: Frontmatter = {
    ...(parsed.data as Frontmatter),
    tts: {
      provider: rawTts.provider ?? "edge",
      voice: rawTts.voice ?? "en-US-AriaNeural",
      rate: rawTts.rate ?? "+0%",
      music_duck: rawTts.music_duck ?? true,
    },
  };
  if (!frontmatter.title || !frontmatter.url) {
    throw new Error("missing or incomplete frontmatter (need `title` and `url`)");
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

  // Compute byte offset where post-frontmatter content begins.
  let contentStartByte = 0;
  {
    let d = 0;
    let byte = 0;
    for (let i = 0; i < allLines.length; i++) {
      if (allLines[i] === "---") {
        d++;
        if (d === 2) {
          contentStartByte = byte + allLines[i].length + 1; // past "---\n"
          break;
        }
      }
      byte += allLines[i].length + 1; // +1 for the newline
    }
  }

  const DELIM = "\n---\n".length; // 5

  const sceneChunks = splitOnFenceAwareDelimiter(parsed.content);
  const scenes: Scene[] = [];
  let runningOffset = contentStartLine;
  let runningByteOffset = contentStartByte;
  for (let chunkIdx = 0; chunkIdx < sceneChunks.length; chunkIdx++) {
    const chunk = sceneChunks[chunkIdx];
    const chunkLines = chunk.split("\n").length;
    const trimmed = chunk.trim();
    const isLast = chunkIdx === sceneChunks.length - 1;
    if (!trimmed) {
      runningOffset += chunkLines + (isLast ? 0 : 1);
      runningByteOffset += chunk.length + (isLast ? 0 : DELIM);
      continue;
    }
    scenes.push(parseScene(chunk, runningOffset, runningByteOffset));
    runningOffset += chunkLines + (isLast ? 0 : 1);
    runningByteOffset += chunk.length + (isLast ? 0 : DELIM);
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

function parseScene(chunk: string, baseLine: number, baseByte: number): Scene {
  const lines = chunk.split("\n");
  let i = 0;
  // running byte offset within `chunk`, lockstep with `i`
  let byteIn = 0;
  while (i < lines.length && lines[i].trim() === "") {
    byteIn += lines[i].length + 1;
    i++;
  }
  const headingMatch = lines[i]?.match(/^# (.+)$/);
  if (!headingMatch) {
    throw new Error(`scene at line ${baseLine + i + 1} has no heading`);
  }
  const title = headingMatch[1].trim();
  const sourceLine = baseLine + i + 1;
  byteIn += lines[i].length + 1;
  i++;

  const proseLines: string[] = [];
  let playwrightCode: Scene["playwrightCode"];
  let playwrightFenceStartByte = -1;
  let playwrightFenceStartLine = -1;
  const overlays: OverlayDirective[] = [];

  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^```(\w+)?\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] ?? "";
      const fenceStartLine = baseLine + i + 1;
      byteIn += lines[i].length + 1;
      i++;
      const body: string[] = [];
      const bodyStartByteInChunk = byteIn;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        byteIn += lines[i].length + 1;
        i++;
      }
      if (i >= lines.length) {
        throw new Error(`unterminated code fence starting at line ${fenceStartLine}`);
      }
      byteIn += lines[i].length + 1;
      i++;
      if (lang === "playwright") {
        const code = body.join("\n");
        playwrightCode = { code, sourceLine: fenceStartLine };
        playwrightFenceStartByte = baseByte + bodyStartByteInChunk;
        playwrightFenceStartLine = fenceStartLine + 1; // first body line is one below the ``` line
      } else if (lang === "overlay") {
        const directive = parseYaml(body.join("\n")) as OverlayDirective;
        if (!directive || typeof directive !== "object" || !directive.type) {
          throw new Error(`overlay block at line ${fenceStartLine} missing \`type\``);
        }
        overlays.push(directive);
      }
    } else {
      proseLines.push(lines[i]);
      byteIn += lines[i].length + 1;
      i++;
    }
  }

  const steps: Step[] = [{ says: [], banners: [] }]; // implicit preamble
  if (playwrightCode) {
    const events = scanStepEvents(playwrightCode.code, playwrightFenceStartByte, playwrightFenceStartLine);
    for (const ev of events) {
      if (ev.kind === "step") {
        steps.push({
          description: ev.text,
          descriptionSpan: ev.span,
          says: [],
          banners: [],
        });
      } else if (ev.kind === "say") {
        const cur = steps[steps.length - 1];
        if (cur.says.length >= 1) {
          throw new Error(
            `at most one fx.say per step (scene "${title}", step "${cur.description ?? "<preamble>"}", line ${ev.span.line})`,
          );
        }
        cur.says.push({ text: ev.text, span: ev.span });
      } else if (ev.kind === "banner") {
        const cur = steps[steps.length - 1];
        if (cur.banners.length >= 1) {
          throw new Error(
            `at most one fx.banner per step (scene "${title}", step "${cur.description ?? "<preamble>"}", line ${ev.span.line})`,
          );
        }
        cur.banners.push({ text: ev.text, span: ev.span });
      }
    }
  }

  return {
    sourceLine,
    title,
    prose: proseLines.join("\n").trim(),
    playwrightCode,
    overlays,
    steps,
  };
}
