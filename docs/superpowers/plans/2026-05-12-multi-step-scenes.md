# Multi-step scenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose each scene into author-defined narrative "steps" via `fx.step("…")`, expose them as editable rows in the visual editor with per-step descriptions, subtitles, banners, and comments.

**Architecture:** A single AST walker over each scene's playwright code emits an ordered list of `step` / `say` / `banner` literal events with file-absolute source spans; the parser folds those into `Scene.steps`. A new `rewriteLiteralAt(file, span, text)` helper byte-range-splices JSON-encoded replacements. The editor renders one row per step and posts edits to a new `POST /api/step` endpoint that calls the same helper. Runtime is metadata-only: a `step` event lands in `events.json` and the recorded video is unchanged.

**Tech Stack:** TypeScript, TypeScript compiler API (`typescript` package, already used for `scanFxSayLiterals`), Vitest, React + Zustand (editor-ui), Playwright (controller).

---

## File Structure

**New files**
- `tests/unit/scan-steps.test.ts` — unit tests for the step-aware AST walker
- `tests/unit/parser-steps.test.ts` — parser-level integration of steps
- `tests/unit/rewrite-literal.test.ts` — byte-range literal rewriter
- `tests/integration/editor-step-api.test.ts` — `POST /api/step` against the live editor server

**Modified files**
- `src/types.ts` — add `SourceSpan`, `StepLiteral`, `Step`; extend `Scene` with `steps`; add `step` to `RunnerEvent`; add `step` to `DemoFx`
- `src/tts/scan.ts` — add `scanStepEvents`; reimplement `scanFxSayLiterals` as a thin filter over it
- `src/parser.ts` — populate `Scene.steps` after extracting the playwright block
- `src/core/rewrite.ts` — add `rewriteLiteralAt(file, span, newText)`
- `src/fx.ts` — implement `fx.step`
- `src/controller.ts` — track per-scene step counter; pass `sceneIndex` to `runScene`
- `src/runner.ts` — pass scene-array index to `controller.runScene`
- `src/core/store.ts` — `SceneRow.steps`; `toRow` copies it; reducer/diff is unchanged (the watcher path compares step content)
- `src/editor/index.ts` — change-detection compares step content; new `rewriteStep` callback wired through
- `src/editor/api.ts` — `handleStep` + `StepCtx`
- `src/editor/server.ts` — route `POST /api/step/:sceneIndex/:stepIndex`
- `src/editor/prompt.ts` — extend `DraftLike.targetKind` with `step.description | step.say | step.banner` and add the formatter branches
- `editor-ui/src/lib/types.ts` — mirror `Step`, extend `SceneRow.steps`
- `editor-ui/src/lib/api.ts` — `setStep(sceneIndex, stepIndex, kind, text)`
- `editor-ui/src/lib/prompt.ts` — keep in lockstep with `src/editor/prompt.ts`
- `editor-ui/src/store.ts` — `Draft.stepIndex`; widen `Draft.targetKind`
- `editor-ui/src/components/Script.tsx` — render per-step rows; replace the single contentEditable with one per editable field per step
- `editor-ui/src/components/Composer.tsx` — accept step-targeted drafts (no API change beyond `target` shape)
- `tests/e2e/smoke.test.ts` — assert `step` event present
- `tests/fixtures/demos/two-scene.demo` — add one `fx.step` call to exercise the path
- `README.md` — fx.step subsection in "Tips for AI agents" + updated worked example + `fx.step` row in the runtime signature table

---

## Task 1: Type additions

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add SourceSpan / StepLiteral / Step and extend Scene**

In `src/types.ts`, add the following exports near the existing `Scene` interface (between the `OverlayDirective` declaration and `Scene`):

```ts
export interface SourceSpan {
  /** Byte offset within the full .demo file. */
  start: number;
  /** Exclusive byte offset within the full .demo file. */
  end: number;
  /** 1-based line within the .demo file (for error messages). */
  line: number;
}

export interface StepLiteral {
  text: string;
  span: SourceSpan;
}

export interface Step {
  /** Author description (the fx.step("...") literal). undefined for the implicit
   *  preamble that wraps statements appearing before the first fx.step call. */
  description?: string;
  descriptionSpan?: SourceSpan;
  /** 0 or 1 entries — enforced by parser invariant. */
  says: StepLiteral[];
  /** 0 or 1 entries — enforced by parser invariant. */
  banners: StepLiteral[];
}
```

Change the existing `Scene` interface to include a `steps` field. Update the existing block:

```ts
export interface Scene {
  /** 1-based line number in the source where the heading sits. */
  sourceLine: number;
  title: string;
  prose: string;
  playwrightCode?: { code: string; sourceLine: number };
  overlays: OverlayDirective[];
  /** Always length >= 1. steps[0] is the implicit preamble (no description).
   *  Each explicit fx.step() call appends a new entry. */
  steps: Step[];
}
```

- [ ] **Step 2: Add step to RunnerEvent**

In `src/types.ts`, extend the `RunnerEvent` union (around line 52). Add the new variant:

```ts
export type RunnerEvent =
  | { kind: "scene_start"; t: number; index: number; title: string; prose: string }
  | { kind: "scene_end"; t: number; index: number }
  | { kind: "fx"; t: number; method: string; args: unknown[] }
  | { kind: "say"; t: number; hash: string; text: string; durationMs: number }
  | { kind: "step"; t: number; sceneIndex: number; stepIndex: number; description: string }
  | { kind: "overlay"; t: number; directive: OverlayDirective; bbox: BBox | null }
  | { kind: "log"; t: number; level: "log" | "warn" | "error"; args: unknown[] }
  | { kind: "error"; t: number; message: string; sceneIndex: number };
```

- [ ] **Step 3: Add step to DemoFx**

In `src/types.ts`, extend `DemoFx`. After the existing `hideBanner()` line, add:

```ts
export interface DemoFx {
  cursorTo(selector: string, opts?: { duration?: number }): Promise<void>;
  typeWithDelay(selector: string, text: string, cps?: number): Promise<void>;
  zoom(selector: string, factor?: number, duration?: number): Promise<void>;
  pause(seconds: number): Promise<void>;
  callout(text: string, target?: string, duration?: number): Promise<void>;
  highlight(selector: string, duration?: number): Promise<void>;
  say(text: string, opts?: { voice?: string; rate?: string }): Promise<void>;
  banner(text: string, opts?: { duration?: number; title?: string }): Promise<void>;
  hideBanner(): Promise<void>;
  step(description: string): Promise<void>;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: errors only in `src/fx.ts` (missing `step` impl), `src/parser.ts` (missing `steps` in returned scenes). These are fixed by later tasks. **Do not commit yet.**

- [ ] **Step 5: Make parser temporarily compile**

Open `src/parser.ts`. In the final `return` inside `parseScene` (around line 129), add `steps: []` to keep the type system happy until Task 3:

```ts
  return {
    sourceLine,
    title,
    prose: proseLines.join("\n").trim(),
    playwrightCode,
    overlays,
    steps: [],
  };
```

- [ ] **Step 6: Make fx.ts temporarily compile**

Open `src/fx.ts`. Inside the returned object literal (after `hideBanner` around line 113-116), add a stub `step` method that throws; Task 5 will replace it:

```ts
    async hideBanner() {
      emit("hideBanner", []);
      await page.evaluate(() => (window as any).__daymo.hideBanner());
    },

    async step(_description) {
      throw new Error("fx.step impl pending");
    },
```

- [ ] **Step 7: Type-check again**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/parser.ts src/fx.ts
git commit -m "feat(types): SourceSpan/Step/step event/DemoFx.step (stubs)"
```

---

## Task 2: AST walker — `scanStepEvents`

**Files:**
- Modify: `src/tts/scan.ts`
- Test: `tests/unit/scan-steps.test.ts`

- [ ] **Step 1: Write failing tests for the walker**

Create `tests/unit/scan-steps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scanStepEvents } from "../../src/tts/scan.js";

const FENCE_OFFSET = 100;
const FENCE_LINE = 10;

describe("scanStepEvents", () => {
  it("emits step/say/banner events in source order with file-absolute spans", () => {
    const code = [
      'await fx.step("first step");',
      'await fx.say("hi");',
      'await fx.banner("Step 1", { duration: 2 });',
      'await fx.step("second step");',
      'await fx.say("bye");',
    ].join("\n");
    const events = scanStepEvents(code, FENCE_OFFSET, FENCE_LINE);
    expect(events.map((e) => ({ kind: e.kind, text: e.text }))).toEqual([
      { kind: "step", text: "first step" },
      { kind: "say", text: "hi" },
      { kind: "banner", text: "Step 1" },
      { kind: "step", text: "second step" },
      { kind: "say", text: "bye" },
    ]);
    // Span start points at the opening quote of the literal, in file coordinates.
    // First "first step" literal: position 13 in code (after `await fx.step(`), +offset.
    expect(events[0].span.start).toBe(FENCE_OFFSET + code.indexOf('"first step"'));
    expect(events[0].span.end).toBe(events[0].span.start + '"first step"'.length);
    // Line numbers are 1-based, file-relative.
    expect(events[0].span.line).toBe(FENCE_LINE);
  });

  it("rejects fx.step with no argument", () => {
    const code = 'await fx.step();';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.step requires a string literal/);
  });

  it("rejects fx.step with a template literal", () => {
    const code = 'await fx.step(`hi ${x}`);';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.step requires a string literal/);
  });

  it("rejects fx.step with a variable arg", () => {
    const code = 'const t = "x"; await fx.step(t);';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.step requires a string literal/);
  });

  it("rejects fx.say with non-literal (existing behavior preserved)", () => {
    const code = 'await fx.say(`hi ${x}`);';
    expect(() => scanStepEvents(code, 0, 1)).toThrow(/fx\.say requires a string literal/);
  });

  it("ignores // comments and string contents that look like calls", () => {
    const code = [
      '// fx.step("not real");',
      'const x = "fx.say(\\"also not real\\")";',
      'await fx.step("real");',
    ].join("\n");
    const events = scanStepEvents(code, 0, 1);
    expect(events.map((e) => e.text)).toEqual(["real"]);
  });

  it("line numbers respect multi-line code", () => {
    const code = 'await fx.step("a");\nawait fx.step("b");';
    const events = scanStepEvents(code, 0, 5);
    expect(events[0].span.line).toBe(5);
    expect(events[1].span.line).toBe(6);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/unit/scan-steps.test.ts`

Expected: FAIL with "scanStepEvents is not a function" or similar.

- [ ] **Step 3: Implement `scanStepEvents`**

Replace the body of `src/tts/scan.ts` with the following:

```ts
// src/tts/scan.ts
import ts from "typescript";

export interface FxSayCall {
  text: string;
  line: number; // 1-based, relative to the playwright code block
}

export type FxLiteralKind = "step" | "say" | "banner";

export interface FxLiteralEvent {
  kind: FxLiteralKind;
  text: string;
  span: {
    start: number; // file-absolute byte offset of the opening quote
    end: number;   // exclusive
    line: number;  // 1-based, file-relative
  };
}

/**
 * Walk JS source for top-level fx.{step,say,banner} calls and return them in
 * source order. The first argument of each call must be a string literal or
 * the walker throws with a precise error.
 *
 * `fenceStartOffset` is the byte offset of `code` within the containing .demo
 * file (so callers get file-absolute spans without bookkeeping).
 *
 * `fenceStartLine` is the 1-based file line of the first line of `code`.
 */
export function scanStepEvents(
  code: string,
  fenceStartOffset: number,
  fenceStartLine: number,
): FxLiteralEvent[] {
  const sf = ts.createSourceFile("scene.ts", code, ts.ScriptTarget.ES2022, /*setParentNodes*/ true);
  const out: FxLiteralEvent[] = [];

  function isFxCall(node: ts.Node): { kind: FxLiteralKind } | null {
    if (!ts.isCallExpression(node)) return null;
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee)) return null;
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "fx") return null;
    const name = callee.name.text;
    if (name === "step" || name === "say" || name === "banner") return { kind: name };
    return null;
  }

  function fileLineOf(node: ts.Node): number {
    // ts line is 0-based, file line is 1-based; offset by fenceStartLine - 1.
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + fenceStartLine;
  }

  function visit(node: ts.Node): void {
    const tag = isFxCall(node);
    if (tag) {
      const call = node as ts.CallExpression;
      const arg = call.arguments[0];
      if (!arg) {
        throw new Error(`fx.${tag.kind} requires a string literal argument: <empty> at line ${fileLineOf(call)}`);
      }
      if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
        const excerpt = code.slice(call.getStart(sf), Math.min(code.length, call.getStart(sf) + 80));
        throw new Error(
          `fx.${tag.kind} requires a string literal: line ${fileLineOf(call)} "${excerpt.replace(/\n/g, " ")}"`,
        );
      }
      // arg.getStart(sf) points at the opening quote of the literal.
      const argStart = arg.getStart(sf);
      const argEnd = arg.getEnd();
      out.push({
        kind: tag.kind,
        text: arg.text,
        span: {
          start: fenceStartOffset + argStart,
          end: fenceStartOffset + argEnd,
          line: fileLineOf(arg),
        },
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return out;
}

/**
 * Back-compat shim: existing callers (TTS pre-synthesis) only need say literals
 * and use code-relative line numbers. Implemented on top of scanStepEvents.
 */
export function scanFxSayLiterals(code: string): FxSayCall[] {
  return scanStepEvents(code, 0, 1)
    .filter((e) => e.kind === "say")
    .map((e) => ({ text: e.text, line: e.span.line }));
}
```

- [ ] **Step 4: Run scan tests and verify pass**

Run: `npx vitest run tests/unit/scan-steps.test.ts tests/unit/tts-scan.test.ts`

Expected: both files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tts/scan.ts tests/unit/scan-steps.test.ts
git commit -m "feat(scan): scanStepEvents — step/say/banner with file-absolute spans"
```

---

## Task 3: Fold events into `Scene.steps` in the parser

**Files:**
- Modify: `src/parser.ts`
- Test: `tests/unit/parser-steps.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `tests/unit/parser-steps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser.js";

const HEADER = `---
title: T
url: http://x
---

`;

describe("parser — steps", () => {
  it("produces a single implicit-preamble step when there's no fx.step", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await page.click("#a");',
      "```",
      "",
    ].join("\n");
    const ast = parse(src);
    expect(ast.scenes[0].steps).toHaveLength(1);
    expect(ast.scenes[0].steps[0].description).toBeUndefined();
    expect(ast.scenes[0].steps[0].says).toEqual([]);
    expect(ast.scenes[0].steps[0].banners).toEqual([]);
  });

  it("opens new steps on fx.step calls; preamble holds pre-step literals", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.say("preamble line");',
      'await fx.step("first step");',
      'await fx.say("inside first");',
      'await fx.banner("Banner A");',
      'await fx.step("second step");',
      "```",
      "",
    ].join("\n");
    const ast = parse(src);
    const steps = ast.scenes[0].steps;
    expect(steps).toHaveLength(3); // preamble + 2 explicit
    expect(steps[0].description).toBeUndefined();
    expect(steps[0].says.map((s) => s.text)).toEqual(["preamble line"]);
    expect(steps[1].description).toBe("first step");
    expect(steps[1].says.map((s) => s.text)).toEqual(["inside first"]);
    expect(steps[1].banners.map((b) => b.text)).toEqual(["Banner A"]);
    expect(steps[2].description).toBe("second step");
  });

  it("spans are file-absolute: a sliced fx.step literal round-trips", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.step("hello world");',
      "```",
      "",
    ].join("\n");
    const ast = parse(src);
    const span = ast.scenes[0].steps[1].descriptionSpan!;
    expect(src.slice(span.start, span.end)).toBe('"hello world"');
  });

  it("rejects two fx.say in the same step", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.step("only one say allowed");',
      'await fx.say("first");',
      'await fx.say("second");',
      "```",
      "",
    ].join("\n");
    expect(() => parse(src)).toThrow(/at most one fx\.say per step/);
  });

  it("rejects two fx.banner in the same step", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.step("only one banner allowed");',
      'await fx.banner("A");',
      'await fx.banner("B");',
      "```",
      "",
    ].join("\n");
    expect(() => parse(src)).toThrow(/at most one fx\.banner per step/);
  });

  it("preamble can also hit the invariants", () => {
    const src = HEADER + [
      "# Scene 1",
      "",
      "```playwright",
      'await fx.say("a");',
      'await fx.say("b");',
      "```",
      "",
    ].join("\n");
    expect(() => parse(src)).toThrow(/at most one fx\.say per step/);
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run tests/unit/parser-steps.test.ts`

Expected: FAIL — `steps` is the empty stub from Task 1.

- [ ] **Step 3: Wire `scanStepEvents` into the parser**

In `src/parser.ts`, add an import at the top:

```ts
import { scanStepEvents } from "./tts/scan.js";
```

Then replace the section inside `parseScene` that handles the playwright fence (currently lines ~114-121) so it computes the fence start offset within the full source. The current code only has `baseLine` (line offset within file). We need a byte offset too. The cleanest fix is to thread a `baseOffset` parameter through.

Above the loop, add a `runningByteOffset` tracker. Replace the existing `let runningOffset = contentStartLine;` block (lines 44-56) with the following. The arithmetic relies on the invariant that `splitOnFenceAwareDelimiter` returns chunks joined by the 5-byte sequence `"\n---\n"` to reconstruct the post-frontmatter content. So each non-last chunk's start in the source is the previous chunk's start + previous chunk length + 5.

```ts
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
```

Now update `parseScene`'s signature and replace the playwright fence handling and final return. Find the current `function parseScene(chunk: string, baseLine: number): Scene {` and replace the whole function:

```ts
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
      const fenceByteIn = byteIn + lines[i].length + 1; // first line *inside* the fence
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
```

Also add the import for `Step` near the top of `src/parser.ts`:

```ts
import type { DemoAst, Frontmatter, OverlayDirective, Scene, Step } from "./types.js";
```

- [ ] **Step 4: Run parser tests and verify pass**

Run: `npx vitest run tests/unit/parser-steps.test.ts tests/unit/parser.test.ts`

Expected: PASS for both files.

- [ ] **Step 5: Run the whole suite to catch regressions**

Run: `npx vitest run`

Expected: PASS across all tests.

- [ ] **Step 6: Commit**

```bash
git add src/parser.ts tests/unit/parser-steps.test.ts
git commit -m "feat(parser): fold step/say/banner events into Scene.steps with invariants"
```

---

## Task 4: `rewriteLiteralAt` helper

**Files:**
- Modify: `src/core/rewrite.ts`
- Test: `tests/unit/rewrite-literal.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/rewrite-literal.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rewriteLiteralAt } from "../../src/core/rewrite.js";

describe("rewriteLiteralAt", () => {
  let file: string;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rewrite-lit-"));
    file = path.join(dir, "demo.txt");
  });

  it("replaces the byte range with a JSON-encoded literal", async () => {
    const src = 'before "old text" after';
    await fs.writeFile(file, src);
    const start = src.indexOf('"old text"');
    await rewriteLiteralAt(file, { start, end: start + '"old text"'.length, line: 1 }, "new text");
    expect(await fs.readFile(file, "utf8")).toBe('before "new text" after');
  });

  it("JSON-encodes quotes and newlines safely", async () => {
    const src = 'x = "old";';
    await fs.writeFile(file, src);
    const start = src.indexOf('"old"');
    await rewriteLiteralAt(file, { start, end: start + '"old"'.length, line: 1 }, 'has "quotes"\nand newline');
    const after = await fs.readFile(file, "utf8");
    expect(after).toBe('x = "has \\"quotes\\"\\nand newline";');
  });

  it("does not perturb surrounding bytes", async () => {
    const src = '\nawait fx.say("hello world");\n// trailing comment\n';
    await fs.writeFile(file, src);
    const start = src.indexOf('"hello world"');
    await rewriteLiteralAt(file, { start, end: start + '"hello world"'.length, line: 2 }, "bye");
    expect(await fs.readFile(file, "utf8")).toBe('\nawait fx.say("bye");\n// trailing comment\n');
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx vitest run tests/unit/rewrite-literal.test.ts`

Expected: FAIL — `rewriteLiteralAt is not a function`.

- [ ] **Step 3: Implement `rewriteLiteralAt`**

Append the following to `src/core/rewrite.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { SourceSpan } from "../types.js";

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
```

Make sure the existing imports at the top of the file include `fs` and `path` (they may not — add them if missing). The final file should start:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "../parser.js";
import type { SourceSpan } from "../types.js";

export function rewriteSceneProse(...) { /* unchanged */ }

export async function rewriteLiteralAt(...) { /* as above */ }
```

If `path` is unused after this edit, drop it.

- [ ] **Step 4: Run tests and verify pass**

Run: `npx vitest run tests/unit/rewrite-literal.test.ts tests/unit/script-rewrite.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rewrite.ts tests/unit/rewrite-literal.test.ts
git commit -m "feat(core): rewriteLiteralAt — byte-range literal replacement"
```

---

## Task 5: `fx.step` runtime implementation

**Files:**
- Modify: `src/fx.ts`, `src/controller.ts`, `src/runner.ts`
- Test: existing `tests/unit/fx.test.ts` extended

- [ ] **Step 1: Write a failing test for fx.step event emission**

Open `tests/unit/fx.test.ts`. Add a new describe block at the bottom of the file (before the final closing brace if there is one, otherwise just append):

```ts
import { describe, it, expect } from "vitest";
import { createFx } from "../../src/fx.js";
import type { RunnerEvent } from "../../src/types.js";

describe("fx.step", () => {
  it("emits a step event with stepIndex and description", async () => {
    const events: RunnerEvent[] = [];
    const fakePage = { evaluate: async () => {} } as any;
    const fx = createFx(fakePage, events, () => 42, undefined, {
      sceneIndex: 3,
      nextStepIndex: () => 1,
    });
    await fx.step("Open the dialog");
    expect(events).toEqual([
      { kind: "step", t: 42, sceneIndex: 3, stepIndex: 1, description: "Open the dialog" },
    ]);
  });
});
```

(Append at the very end of the file — do not nest inside an existing describe.)

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/unit/fx.test.ts`

Expected: FAIL — `createFx` signature mismatch.

- [ ] **Step 3: Extend `createFx` with step context**

In `src/fx.ts`, add a new context interface and a new optional parameter. Update the file:

```ts
// src/fx.ts
import type { Page } from "playwright";
import type { BBox, DemoFx, RunnerEvent, WordTiming } from "./types.js";

export type Clock = () => number;

export interface SayContext {
  sayTable: Record<string, { durationMs: number; words: WordTiming[] }>;
  sayHashFor: (text: string) => string | null;
}

export interface StepContext {
  /** Position of the current scene in the AST scenes array (0-based). */
  sceneIndex: number;
  /** Returns the index that should be assigned to the next fx.step call.
   *  Implementation is expected to increment its own counter. */
  nextStepIndex: () => number;
}

export function createFx(
  page: Page,
  events: RunnerEvent[],
  clock: Clock,
  sayCtx?: SayContext,
  stepCtx?: StepContext,
): DemoFx {
  /* ...existing emit, measure, etc... */
```

Then replace the stubbed `step` method (added in Task 1) with the real implementation. Inside the returned object, change the existing stub to:

```ts
    async step(description) {
      if (!stepCtx) {
        // Outside of a capture context (e.g. dry runs) — silently no-op.
        return;
      }
      events.push({
        kind: "step",
        t: clock(),
        sceneIndex: stepCtx.sceneIndex,
        stepIndex: stepCtx.nextStepIndex(),
        description,
      });
    },
```

- [ ] **Step 4: Run the fx test and verify pass**

Run: `npx vitest run tests/unit/fx.test.ts`

Expected: PASS.

- [ ] **Step 5: Thread sceneIndex into Controller.runScene**

In `src/controller.ts`, change `runScene` to accept a scene index. Replace the signature line (currently `async runScene(scene: Scene): Promise<void> {`):

```ts
  async runScene(scene: Scene, sceneIndex: number): Promise<void> {
```

Then inside the method, where `createFx` is invoked (around line 97), construct a step context and pass it through. Replace the `const fx = createFx(...)` line with:

```ts
        let stepCounter = 0;
        const stepCtx = { sceneIndex, nextStepIndex: () => ++stepCounter };
        const fx = createFx(this.page, this.events, () => this.now(), sayCtx, stepCtx);
```

(`nextStepIndex` returns `1` for the first explicit step, matching the AST `steps[1]` invariant — see the spec.)

- [ ] **Step 6: Update the runner to pass sceneIndex**

In `src/runner.ts`, update the loop (currently `for (const scene of ast.scenes) { await ctrl.runScene(scene); }`):

```ts
    for (let i = 0; i < ast.scenes.length; i++) {
      await ctrl.runScene(ast.scenes[i], i);
    }
```

- [ ] **Step 7: Find every other caller of `runScene` and pass an index**

Run: `grep -rn "runScene" src tests | grep -v "\.test\.ts:.*scanStepEvents\|\.test\.ts:.*createFx"`

For each caller (besides `src/runner.ts` and `src/controller.ts` itself), pass a sceneIndex. Likely callers: `src/core/capture.ts`, `src/commands/capture.ts`, `src/editor/capture.ts`. Update them to pass the scene index they already know (e.g. `await ctrl.runScene(scenes[i], i)`). If a caller invokes `runScene` for exactly one scene (single-scene capture), pass the scene's actual array index, not `0`.

To find it precisely:

```bash
grep -rn "runScene" src/core/capture.ts src/commands/capture.ts src/editor/capture.ts 2>/dev/null
```

Inspect each call site and pass the correct index. (The capture command takes `--scene N` 1-indexed; convert to 0-indexed before passing.)

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/fx.ts src/controller.ts src/runner.ts src/core/capture.ts src/commands/capture.ts src/editor/capture.ts tests/unit/fx.test.ts
git commit -m "feat(controller): fx.step emits step events with sceneIndex/stepIndex"
```

---

## Task 6: Editor state — surface `steps` and invalidate captures on step edits

**Files:**
- Modify: `src/core/store.ts`, `src/editor/index.ts`
- Test: extend `tests/unit/core-store.test.ts`

- [ ] **Step 1: Write a failing test for `SceneRow.steps`**

Open `tests/unit/core-store.test.ts`. Add a test:

```ts
import { initialState } from "../../src/core/store.js";
import type { Scene } from "../../src/types.js";

describe("core/store — SceneRow.steps", () => {
  it("hydrates steps from Scene", () => {
    const scenes: Scene[] = [{
      sourceLine: 1,
      title: "T",
      prose: "",
      overlays: [],
      steps: [
        { says: [], banners: [] },
        { description: "Step A", descriptionSpan: { start: 0, end: 10, line: 4 }, says: [], banners: [] },
      ],
    }];
    const s = initialState({ demoFile: "x.demo", scenes });
    expect(s.scenes[0].steps).toHaveLength(2);
    expect(s.scenes[0].steps[1].description).toBe("Step A");
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/unit/core-store.test.ts`

Expected: FAIL — `steps` property missing on `SceneRow`.

- [ ] **Step 3: Extend `SceneRow` and `toRow`**

Edit `src/core/store.ts`. Update the imports:

```ts
import type { Scene, Step } from "../types.js";
```

Update `SceneRow`:

```ts
export interface SceneRow {
  sourceLine: number;
  title: string;
  prose: string;
  overlays: Scene["overlays"];
  steps: Step[];
  state: SceneState;
  webmPath?: string;
  eventsPath?: string;
  capturedAt?: number;
  errorMessage?: string;
}
```

Update `toRow`:

```ts
function toRow(s: Scene): SceneRow {
  return {
    sourceLine: s.sourceLine,
    title: s.title,
    prose: s.prose,
    overlays: s.overlays,
    steps: s.steps,
    state: "pending",
  };
}
```

- [ ] **Step 4: Run the store test and verify pass**

Run: `npx vitest run tests/unit/core-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Update editor change-detection to compare steps**

Edit `src/editor/index.ts`. Find the watcher's `onChange` callback (around lines 53-67). The current change-detection compares `sourceLine`, `prose`, `title`. After a step rewrite, the source has changed, so we want to mark the affected scene `pending`. The simplest robust approach is to compare a stable serialization of the scene's editable surface.

Replace the change-detection inner block with:

```ts
  const stepsKey = (steps: import("../types.js").Step[]) =>
    steps.map((s) => `${s.description ?? ""}|${s.says.map((x) => x.text).join("§")}|${s.banners.map((x) => x.text).join("§")}`).join("¶");

  // existing onChange:
  onChange: async () => {
    const newAst = await readAst();
    if (newAst.scenes.length !== state.scenes.length) {
      state = reduce(state, { type: "scenes-replaced", scenes: newAst.scenes });
    } else {
      for (let i = 0; i < state.scenes.length; i++) {
        const oldRow = state.scenes[i];
        const newScene = newAst.scenes[i];
        const changed =
          newScene.sourceLine !== oldRow.sourceLine ||
          newScene.prose !== oldRow.prose ||
          newScene.title !== oldRow.title ||
          stepsKey(newScene.steps) !== stepsKey(oldRow.steps);
        if (changed) {
          state = reduce(state, { type: "scene-changed", sceneIndex: i });
        }
      }
      // even if no captures are invalidated, refresh the row payloads
      // so the UI sees new step content.
      state = {
        ...state,
        scenes: state.scenes.map((row, i) => ({ ...row, steps: newAst.scenes[i].steps, title: newAst.scenes[i].title, prose: newAst.scenes[i].prose })),
      };
    }
    ast = newAst;
    void saveState(stateFile, state);
    sse.publish({ type: "demo-changed" });
    sse.publish({ type: "state", state });
  },
```

(The `stepsKey` helper can live just above the `const watcher = new Watcher({` declaration, in the outer closure.)

- [ ] **Step 6: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/store.ts src/editor/index.ts tests/unit/core-store.test.ts
git commit -m "feat(editor): SceneRow.steps + step-aware change detection"
```

---

## Task 7: Editor API — `POST /api/step/:sceneIndex/:stepIndex`

**Files:**
- Modify: `src/editor/api.ts`, `src/editor/server.ts`, `src/editor/index.ts`
- Test: `tests/integration/editor-step-api.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/editor-step-api.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { startEditor, type EditorHandle } from "../../src/editor/index.js";

const DEMO_SRC = `---
title: T
url: http://localhost:9999
---

# Scene 1

\`\`\`playwright
await fx.step("Click the button");
await fx.say("hello");
await fx.banner("Banner A");
\`\`\`
`;

describe("editor /api/step", () => {
  let dir: string;
  let demoFile: string;
  let h: EditorHandle;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "editor-step-"));
    demoFile = path.join(dir, "x.demo");
    await fs.writeFile(demoFile, DEMO_SRC);
    h = await startEditor({ demoFile });
  });

  afterEach(async () => {
    await h.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function post(body: object) {
    return fetch(`${h.url}/api/step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rewrites a step description", async () => {
    const r = await post({ sceneIndex: 0, stepIndex: 1, kind: "description", text: "New description" });
    expect(r.status).toBe(200);
    const src = await fs.readFile(demoFile, "utf8");
    expect(src).toContain('await fx.step("New description");');
  });

  it("rewrites a step say literal", async () => {
    const r = await post({ sceneIndex: 0, stepIndex: 1, kind: "say", text: "Goodbye" });
    expect(r.status).toBe(200);
    const src = await fs.readFile(demoFile, "utf8");
    expect(src).toContain('await fx.say("Goodbye");');
  });

  it("rewrites a step banner literal", async () => {
    const r = await post({ sceneIndex: 0, stepIndex: 1, kind: "banner", text: "Banner B" });
    expect(r.status).toBe(200);
    const src = await fs.readFile(demoFile, "utf8");
    expect(src).toContain('await fx.banner("Banner B"');
  });

  it("rejects editing the preamble description", async () => {
    const r = await post({ sceneIndex: 0, stepIndex: 0, kind: "description", text: "x" });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/preamble/);
  });

  it("rejects out-of-range scene", async () => {
    const r = await post({ sceneIndex: 99, stepIndex: 0, kind: "description", text: "x" });
    expect(r.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run tests/integration/editor-step-api.test.ts`

Expected: FAIL — endpoint not implemented.

- [ ] **Step 3: Add `handleStep` in api.ts**

Append to `src/editor/api.ts`:

```ts
export interface StepCtx extends ApiCtx {
  rewriteStep(
    sceneIndex: number,
    stepIndex: number,
    kind: "description" | "say" | "banner",
    text: string,
  ): Promise<void>;
  sceneCount(): number;
}

export interface StepBody {
  sceneIndex: number;
  stepIndex: number;
  kind: "description" | "say" | "banner";
  text: string;
}

export async function handleStep(
  ctx: StepCtx,
  body: StepBody,
  res: ServerResponse,
): Promise<void> {
  if (body.sceneIndex < 0 || body.sceneIndex >= ctx.sceneCount()) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "scene out of range" }));
    return;
  }
  if (!body.kind || (body.kind !== "description" && body.kind !== "say" && body.kind !== "banner")) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid kind" }));
    return;
  }
  try {
    await ctx.rewriteStep(body.sceneIndex, body.stepIndex, body.kind, body.text);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
```

- [ ] **Step 4: Wire the route in server.ts**

In `src/editor/server.ts`, add `rewriteStep` to `ServerOpts`:

```ts
export interface ServerOpts {
  port: number;
  sse: SseBus;
  getState: () => EditorState;
  enqueueCapture: (sceneIndex: number) => void;
  rewriteProse: (sceneIndex: number, prose: string) => Promise<void>;
  rewriteStep: (
    sceneIndex: number,
    stepIndex: number,
    kind: "description" | "say" | "banner",
    text: string,
  ) => Promise<void>;
  stitchNow: () => Promise<string>;
  uiDir?: string;
  capturesDir: string;
}
```

Update the imports at the top of the file:

```ts
import { handleGetState, handleEvents, handleCapture, handleScript, handleStitch, handleStep, readJson, notFound } from "./api.js";
```

Inside the `http.createServer` callback, add a new branch above the `/api/stitch` handler:

```ts
      if (url.pathname === "/api/step" && req.method === "POST") {
        const body = await readJson<{ sceneIndex: number; stepIndex: number; kind: "description" | "say" | "banner"; text: string }>(req);
        return handleStep(
          {
            ...ctx,
            rewriteStep: opts.rewriteStep,
            sceneCount: () => opts.getState().scenes.length,
          },
          body,
          res,
        );
      }
```

- [ ] **Step 5: Implement `rewriteStep` in editor/index.ts**

In `src/editor/index.ts`, add an import:

```ts
import { rewriteLiteralAt } from "../core/rewrite.js";
```

Add a `rewriteStep` function near the existing `rewriteProse`:

```ts
  const rewriteStep = async (
    sceneIndex: number,
    stepIndex: number,
    kind: "description" | "say" | "banner",
    text: string,
  ) => {
    const scene = ast.scenes[sceneIndex];
    if (!scene) throw new Error(`scene ${sceneIndex} out of range`);
    const step = scene.steps[stepIndex];
    if (!step) throw new Error(`step ${stepIndex} out of range in scene ${sceneIndex}`);
    let span: import("../types.js").SourceSpan | undefined;
    if (kind === "description") {
      if (!step.descriptionSpan) {
        throw new Error("cannot edit preamble description — add an explicit fx.step() call first");
      }
      span = step.descriptionSpan;
    } else if (kind === "say") {
      if (step.says.length === 0) {
        throw new Error("step has no fx.say to edit");
      }
      span = step.says[0].span;
    } else {
      if (step.banners.length === 0) {
        throw new Error("step has no fx.banner to edit");
      }
      span = step.banners[0].span;
    }
    watcher.suppressNext();
    await rewriteLiteralAt(demoFile, span!, text);
    ast = await readAst();
    state = reduce(state, { type: "scene-changed", sceneIndex });
    // refresh row payloads so UI sees new literals
    state = {
      ...state,
      scenes: state.scenes.map((row, i) => ({ ...row, steps: ast.scenes[i].steps, title: ast.scenes[i].title, prose: ast.scenes[i].prose })),
    };
    void saveState(stateFile, state);
    sse.publish({ type: "state", state });
  };
```

Pass it to the server:

```ts
  const srv: ServerHandle = await startServer({
    port: opts.port ?? 0,
    sse,
    getState: () => state,
    enqueueCapture: (i) => queue.enqueue(i),
    rewriteProse,
    rewriteStep,
    stitchNow,
    uiDir: opts.uiDir,
    capturesDir,
  });
```

- [ ] **Step 6: Run the integration test and verify pass**

Run: `npx vitest run tests/integration/editor-step-api.test.ts`

Expected: PASS for all 5 cases.

- [ ] **Step 7: Run the full suite for regressions**

Run: `npx vitest run`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/editor/api.ts src/editor/server.ts src/editor/index.ts tests/integration/editor-step-api.test.ts
git commit -m "feat(editor): POST /api/step rewrites description/say/banner literals"
```

---

## Task 8: Editor UI — types, API client, store, prompt formatter

**Files:**
- Modify: `editor-ui/src/lib/types.ts`, `editor-ui/src/lib/api.ts`, `editor-ui/src/lib/prompt.ts`, `editor-ui/src/store.ts`, `src/editor/prompt.ts`

This task only changes the data layer of the UI. The Script.tsx rewrite is the next task.

- [ ] **Step 1: Extend client `SceneRow` with `steps`**

Edit `editor-ui/src/lib/types.ts`:

```ts
export type SceneState = "pending" | "captured";
export interface OverlayDirective {
  type: "callout" | "highlight";
  target?: string;
  text?: string;
  duration?: string;
  [k: string]: unknown;
}
export interface SourceSpan { start: number; end: number; line: number }
export interface StepLiteral { text: string; span: SourceSpan }
export interface Step {
  description?: string;
  descriptionSpan?: SourceSpan;
  says: StepLiteral[];
  banners: StepLiteral[];
}
export interface SceneRow {
  sourceLine: number;
  title: string;
  prose: string;
  overlays: OverlayDirective[];
  steps: Step[];
  state: SceneState;
  webmPath?: string;
  eventsPath?: string;
  capturedAt?: number;
  errorMessage?: string;
}
export interface EditorState {
  demoFile: string;
  scenes: SceneRow[];
}
```

- [ ] **Step 2: Add `setStep` to the API client**

Edit `editor-ui/src/lib/api.ts`:

```ts
import type { EditorState } from "./types";

async function jsonOrThrow<T>(p: Promise<Response>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  state: (): Promise<EditorState> => jsonOrThrow(fetch("/api/state")),
  capture: (i: number) => jsonOrThrow(fetch(`/api/capture/${i}`, { method: "POST" })),
  setProse: (i: number, prose: string) =>
    jsonOrThrow(
      fetch(`/api/script/${i}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prose }),
      }),
    ),
  setStep: (
    sceneIndex: number,
    stepIndex: number,
    kind: "description" | "say" | "banner",
    text: string,
  ) =>
    jsonOrThrow(
      fetch(`/api/step`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sceneIndex, stepIndex, kind, text }),
      }),
    ),
  stitch: () => jsonOrThrow<{ output: string }>(fetch("/api/stitch", { method: "POST" })),
};
```

- [ ] **Step 3: Extend `Draft` with stepIndex / step kinds**

Edit `editor-ui/src/store.ts`. Replace the `Draft` interface:

```ts
export interface Draft {
  id: string;
  sceneIndex: number;
  /** Target of the comment. New step.* kinds carry a stepIndex. */
  targetKind:
    | "caption"
    | "overlay"
    | "step.description"
    | "step.say"
    | "step.banner";
  targetIndex?: number;
  stepIndex?: number;
  text: string;
}
```

- [ ] **Step 4: Extend the server-side `DraftLike` + prompt formatter**

Edit `src/editor/prompt.ts` (the server copy). Replace the file with:

```ts
import type { EditorState } from "./types.js";

export interface DraftLike {
  id: string;
  sceneIndex: number;
  targetKind:
    | "caption"
    | "overlay"
    | "step.description"
    | "step.say"
    | "step.banner";
  targetIndex?: number;
  stepIndex?: number;
  text: string;
}

export function formatReviewPrompt(state: EditorState, drafts: DraftLike[]): string {
  const lines: string[] = [];
  lines.push(`You're editing \`${state.demoFile}\`. The user has left these review comments —`);
  lines.push(`please apply them as a single edit. Do NOT touch scenes that are not mentioned.`);
  lines.push("");
  drafts.forEach((d, i) => {
    const row = state.scenes[d.sceneIndex];
    lines.push(`# Comment ${i + 1} — Scene ${d.sceneIndex + 1} (${d.targetKind})`);
    lines.push("");
    if (d.targetKind === "caption") {
      lines.push("Current text:");
      for (const ln of row.prose.split("\n")) lines.push(`> ${ln}`);
    } else if (d.targetKind === "overlay") {
      const ov = row.overlays[d.targetIndex ?? 0];
      lines.push("Current overlay:");
      lines.push("```yaml");
      lines.push(`type: ${ov.type}`);
      if (ov.target) lines.push(`target: "${ov.target}"`);
      if (ov.text) lines.push(`text: "${ov.text}"`);
      if (ov.duration) lines.push(`duration: ${ov.duration}`);
      lines.push("```");
    } else {
      // step.* kinds
      const step = row.steps[d.stepIndex ?? 0];
      const label = step?.description ?? "<preamble>";
      lines.push(`Step ${d.stepIndex} — "${label}"`);
      if (d.targetKind === "step.description") {
        lines.push(`Current description: "${label}"`);
      } else if (d.targetKind === "step.say") {
        const t = step?.says[0]?.text ?? "<none>";
        lines.push(`Current fx.say: "${t}"`);
      } else if (d.targetKind === "step.banner") {
        const t = step?.banners[0]?.text ?? "<none>";
        lines.push(`Current fx.banner: "${t}"`);
      }
    }
    lines.push("");
    lines.push("User comment:");
    for (const ln of d.text.split("\n")) lines.push(`> ${ln}`);
    lines.push("");
  });
  return lines.join("\n");
}
```

- [ ] **Step 5: Sync the client copy**

Edit `editor-ui/src/lib/prompt.ts`. Replace the file contents with the **same body** as `src/editor/prompt.ts` above, except:
- Change `import type { EditorState } from "./types.js";` → `import type { EditorState } from "./types";`
- Keep the existing `// SYNC: keep this file identical in body to src/editor/prompt.ts.` header.

- [ ] **Step 6: Update existing prompt-format unit test**

Open `tests/unit/prompt-format.test.ts`. Find any places it constructs a `Draft` / `DraftLike` literal. If a test uses `targetKind: "caption"` or `targetKind: "overlay"`, it stays valid. Add one new test case verifying the step.* branches:

```ts
it("formats a step.description comment", () => {
  const state: any = {
    demoFile: "/x.demo",
    scenes: [{
      sourceLine: 1, title: "T", prose: "", overlays: [], steps: [
        { says: [], banners: [] },
        { description: "Click the button", says: [{ text: "hi", span: { start: 0, end: 1, line: 1 } }], banners: [] },
      ], state: "pending",
    }],
  };
  const out = formatReviewPrompt(state, [{
    id: "1", sceneIndex: 0, stepIndex: 1, targetKind: "step.description", text: "rename me",
  }]);
  expect(out).toContain('Step 1 — "Click the button"');
  expect(out).toContain('rename me');
});
```

- [ ] **Step 7: Run the prompt and store-related tests**

Run: `npx vitest run tests/unit/prompt-format.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add editor-ui/src/lib/types.ts editor-ui/src/lib/api.ts editor-ui/src/lib/prompt.ts editor-ui/src/store.ts src/editor/prompt.ts tests/unit/prompt-format.test.ts
git commit -m "feat(editor-ui): step-aware types, api.setStep, prompt formatter"
```

---

## Task 9: Editor UI — `Script.tsx` rewrite

**Files:**
- Modify: `editor-ui/src/components/Script.tsx`, `editor-ui/src/components/Composer.tsx`

- [ ] **Step 1: Replace Script.tsx with a per-step renderer**

Rewrite `editor-ui/src/components/Script.tsx` to:

```tsx
import type { FocusEvent } from "react";
import { useUi } from "../store";
import { api } from "../lib/api";
import { ComposerInline, DraftList } from "./Composer";
import type { Step } from "../lib/types";

export function Script() {
  const { state, selectedSceneIndex } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  return (
    <div className="p-3 text-xs flex flex-col gap-3">
      <div className="opacity-60 text-[10px] uppercase tracking-wide">
        Scene · {row.steps.length} step{row.steps.length === 1 ? "" : "s"}
      </div>
      {row.steps.map((step, stepIndex) => (
        <StepRow
          key={stepIndex}
          sceneIndex={selectedSceneIndex}
          stepIndex={stepIndex}
          step={step}
        />
      ))}
      <DraftList sceneIndex={selectedSceneIndex} />
    </div>
  );
}

function StepRow({
  sceneIndex,
  stepIndex,
  step,
}: {
  sceneIndex: number;
  stepIndex: number;
  step: Step;
}) {
  const isPreamble = step.description === undefined;
  const onDescBlur = async (e: FocusEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText.trim();
    if (text === step.description) return;
    await api.setStep(sceneIndex, stepIndex, "description", text);
  };
  const onSayBlur = async (e: FocusEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText.trim();
    if (text === step.says[0]?.text) return;
    await api.setStep(sceneIndex, stepIndex, "say", text);
  };
  const onBannerBlur = async (e: FocusEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText.trim();
    if (text === step.banners[0]?.text) return;
    await api.setStep(sceneIndex, stepIndex, "banner", text);
  };
  return (
    <div className="border border-zinc-800 rounded p-2 flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="opacity-50 text-[10px] uppercase tracking-wide">
          {isPreamble ? "Preamble" : `Step ${stepIndex}`}
        </span>
        {isPreamble ? (
          <span className="opacity-50 italic">(no description — add fx.step() in source)</span>
        ) : (
          <div
            contentEditable
            suppressContentEditableWarning
            className="flex-1 p-1 rounded bg-zinc-900 outline-none focus:ring-1 focus:ring-zinc-500"
            onBlur={onDescBlur}
          >
            {step.description}
          </div>
        )}
      </div>

      {step.says.length > 0 && (
        <div className="flex items-baseline gap-2">
          <span className="opacity-50 text-[10px] uppercase tracking-wide w-14 flex-shrink-0">Say</span>
          <div
            contentEditable
            suppressContentEditableWarning
            className="flex-1 p-1 rounded bg-zinc-900 outline-none focus:ring-1 focus:ring-zinc-500"
            onBlur={onSayBlur}
          >
            {step.says[0].text}
          </div>
        </div>
      )}

      {step.banners.length > 0 && (
        <div className="flex items-baseline gap-2">
          <span className="opacity-50 text-[10px] uppercase tracking-wide w-14 flex-shrink-0">Banner</span>
          <div
            contentEditable
            suppressContentEditableWarning
            className="flex-1 p-1 rounded bg-zinc-900 outline-none focus:ring-1 focus:ring-zinc-500"
            onBlur={onBannerBlur}
          >
            {step.banners[0].text}
          </div>
        </div>
      )}

      {!isPreamble && (
        <ComposerInline
          sceneIndex={sceneIndex}
          target={{ kind: "step.description", stepIndex }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update Composer.tsx to accept step targets**

Edit `editor-ui/src/components/Composer.tsx`. Update the `Target` type and `targetLabel` helper near the top:

```tsx
type Target =
  | { kind: "caption" }
  | { kind: "overlay"; index: number }
  | { kind: "step.description"; stepIndex: number }
  | { kind: "step.say"; stepIndex: number }
  | { kind: "step.banner"; stepIndex: number };

const targetLabel = (t: Target) => {
  if (t.kind === "caption") return "the caption";
  if (t.kind === "overlay") return `overlay #${t.index + 1}`;
  if (t.kind === "step.description") return `step ${t.stepIndex} description`;
  if (t.kind === "step.say") return `step ${t.stepIndex} subtitle`;
  return `step ${t.stepIndex} banner`;
};
```

Update the `submit` function inside `ComposerInline` to record the step index:

```tsx
  const submit = () => {
    if (!text.trim()) return;
    addDraft({
      sceneIndex,
      targetKind: target.kind,
      targetIndex: target.kind === "overlay" ? target.index : undefined,
      stepIndex:
        target.kind === "step.description" ||
        target.kind === "step.say" ||
        target.kind === "step.banner"
          ? target.stepIndex
          : undefined,
      text: text.trim(),
    });
    setText("");
    setOpen(false);
  };
```

- [ ] **Step 3: Build the editor-ui bundle**

Run: `cd editor-ui && npm install && npm run build && cd ..`

Expected: build succeeds with no TypeScript errors. If a type mismatch surfaces, fix it before committing.

- [ ] **Step 4: Type-check the workspace once more**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add editor-ui/src/components/Script.tsx editor-ui/src/components/Composer.tsx
git commit -m "feat(editor-ui): per-step row rendering with inline edit + step-targeted comments"
```

---

## Task 10: Docs — README updates for AI-agent authors

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add `fx.step` to the runtime signature table**

In `README.md`, find the `### \`fx\` runtime` section. Inside the existing ts block (after `fx.hideBanner()`), add:

```ts
fx.step(description: string)
```

- [ ] **Step 2: Add a "Structuring long scenes into steps" subsection**

Below the existing `### Narration with \`fx.say\`` section (and above `### Pipeline`), insert a new subsection:

````markdown
### Structuring long scenes into steps

Long scenes (a 20-minute walkthrough is fine as one scene) become hard to navigate as a single block. Wrap user-visible actions with `fx.step("…")` to give the editor — and any reviewer — a narrative outline:

```js
await fx.step("Open the new-project dialog");
await fx.cursorTo("[data-testid=new-project-btn]");
await page.click("[data-testid=new-project-btn]");
await fx.say("Click here to start a new project.");
await page.waitForSelector("[role=dialog]");

await fx.step("Name the project");
await page.fill("[name=projectName]", "My first project");
await fx.say("Give it a name.");
```

Each `fx.step` opens a new step and every following statement belongs to it until the next `fx.step` (or the end of the block). The description has no visual effect at render time — it shows up in the editor and in `events.json` only.

**Rules** (enforced at parse time):

- The argument must be a string literal — no template strings, no variables.
- At most one `fx.say` per step. If you'd narrate two different lines, those are two different steps.
- At most one `fx.banner` per step.
- `fx.step` is optional. A scene with no `fx.step` calls behaves exactly as today.
````

- [ ] **Step 3: Replace the worked example**

Find the existing `## Worked example` section and replace its body (the fenced markdown block inside) with:

````markdown
````markdown
---
title: Create your first project
description: Walks a new user through creating their first project.
url: http://localhost:3000
viewport: { width: 1440, height: 900 }
music: gentle-corporate.mp3
mocks:
  - source: inline
    routes:
      "GET /api/me": { "name": "Alex", "plan": "free" }
      "GET /api/projects": []
---

# Onboarding

```playwright
await fx.step("Welcome the user");
await page.waitForSelector("h1:has-text('Projects')");
await fx.say("Welcome back, Alex. This is your project dashboard.");

await fx.step("Open the new-project dialog");
await fx.cursorTo("[data-testid=new-project-btn]");
await page.click("[data-testid=new-project-btn]");
await fx.say("Click here to start a new project.");
await page.waitForSelector("[role=dialog]");

await fx.step("Name the project");
await page.fill("[name=projectName]", "My first project");
await fx.say("Give it a name.");

await fx.step("Submit");
await page.click("button[type=submit]");
```
````
````

- [ ] **Step 4: Update the "Tips for AI agents" tail of the README**

Append two bullets to the existing `## Tips for AI agents authoring \`.demo\` files` bullet list:

```markdown
- Use `fx.step("…")` to break long scenes into named chunks. One step holds one logical user action (cursor + click + say + wait).
- Hard limits per step: at most one `fx.say` and one `fx.banner`. If you'd narrate twice, split into two steps.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: fx.step authoring guide + multi-step worked example"
```

---

## Task 11: E2E — extend smoke fixture and assert step event

**Files:**
- Modify: `tests/fixtures/demos/two-scene.demo`, `tests/e2e/smoke.test.ts`

- [ ] **Step 1: Add an fx.step call to the fixture**

Edit `tests/fixtures/demos/two-scene.demo`. Replace the second scene's playwright block contents (currently three statements) so it opens with an fx.step:

```
# Open the dialog

Now we open the new-project dialog.

```playwright
await fx.step("Open the dialog");
await fx.cursorTo("[data-testid=new-project-btn]");
await page.click("[data-testid=new-project-btn]");
await page.waitForSelector("[data-testid=new-project-dialog][open]");
```
```

(The exact final fenced block is just the existing three statements with `await fx.step("Open the dialog");` prepended on its own line.)

- [ ] **Step 2: Add a step-event assertion to the smoke test**

Edit `tests/e2e/smoke.test.ts`. In the first `it("with music: ...")` block, after the existing assertions on stream codecs, read events.json from the artifacts dir and assert:

```ts
    // events.json should contain a step event for the second scene
    const artifactsDir = path.dirname(mp4Path);
    const events: any[] = JSON.parse(
      await fs.readFile(path.join(artifactsDir, "events.json"), "utf8"),
    );
    const step = events.find((e) => e.kind === "step");
    expect(step).toBeDefined();
    expect(step.description).toBe("Open the dialog");
    expect(step.stepIndex).toBe(1);
    expect(step.sceneIndex).toBe(1); // second scene, 0-indexed
```

- [ ] **Step 3: Run the smoke test**

Run: `npx vitest run tests/e2e/smoke.test.ts`

Expected: PASS for both `with music` and `without music`.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/demos/two-scene.demo tests/e2e/smoke.test.ts
git commit -m "test(e2e): assert step event in events.json with sceneIndex/stepIndex"
```

---

## Task 12: Whole-suite verification + manual editor sanity check

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`

Expected: every test PASSES.

- [ ] **Step 2: Type-check + build**

Run: `npm run build`

Expected: TypeScript compiles cleanly, editor-ui bundle builds.

- [ ] **Step 3: Manual editor sanity check**

If a sample app server is available locally, start the editor against a multi-step demo and verify visually:

```bash
node dist/cli.js edit tests/fixtures/demos/two-scene.demo --port 5180
```

Open `http://localhost:5180`, pick scene 2, confirm:
- "Open the dialog" appears as Step 1 with an editable description box.
- Editing the description and tabbing out persists the change (re-load the URL; description survives).
- The preamble row shows the muted "(no description — add fx.step() in source)" placeholder.

This is a smoke-test of the UI, not an automated check. Note any visual issues for follow-up but they're out of scope for this plan.

- [ ] **Step 4: Final commit (only if any tidy-ups surfaced)**

If steps 1-3 surfaced any small follow-ups, fix and commit. Otherwise skip.

---

## Self-Review Notes (already applied)

- **Spec coverage**: every section of `docs/superpowers/specs/2026-05-12-multi-step-scenes-design.md` is exercised:
  - Format (`fx.step`) — Task 1, Task 5
  - Invariants (≤1 say, ≤1 banner, literal-only arg) — Task 2 (walker), Task 3 (parser)
  - Parser & data model — Task 1, Task 3
  - Rewrite — Task 4, Task 7
  - Controller/runtime — Task 5, Task 11
  - Editor API — Task 7
  - Editor UI — Task 8, Task 9
  - Docs — Task 10
  - Tests — every task lands its own
  - Out-of-scope items are not implemented (no "add new say/banner" UI, no CLI step command, no reorder/split/merge)

- **Placeholder scan**: no TBDs, all code blocks are concrete.

- **Type consistency**: `Step`, `SceneRow.steps`, `StepLiteral`, `SourceSpan` use identical field names everywhere (server types, client types, prompt formatter, test fixtures). `api.setStep` and `POST /api/step` use `kind: "description" | "say" | "banner"`. The Composer's `Target` union uses `"step.description" | "step.say" | "step.banner"` for comment kinds, which mirror the prompt formatter's `targetKind` branches.

- **Watcher coalescing**: Task 7 uses the existing `watcher.suppressNext()` pattern (already used by `rewriteProse`) so the self-write doesn't trigger a redundant onChange round-trip.
