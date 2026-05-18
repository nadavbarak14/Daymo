# Textual Manual Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `daymo manual <file>` CLI command that emits a Markdown how-to (`manual.md`) from a `.demo` file using only the parsed AST — no browser, no screenshots, no new `fx` methods.

**Architecture:** A pure function `emitManual(ast: DemoAst)` in `src/core/manual.ts` produces `{ markdown, warnings }`. A thin CLI handler in `src/commands/manual.ts` reads the file, parses it, calls the emitter, and writes the output. Tests are split between unit-level template snapshots (one per branch) and golden-file snapshots for every shipped `.demo`.

**Tech Stack:** TypeScript, Vitest, `cac` (existing CLI framework), `gray-matter` + `yaml` (already used by the parser). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-14-textual-manual-output-design.md`

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/core/manual.ts` (new) | Pure emitter: AST → `{ markdown, warnings }` |
| `src/commands/manual.ts` (new) | CLI handler: parse → emit → write/print |
| `src/cli.ts` (modify line ~58) | Register `manual` subcommand |
| `tests/unit/manual.test.ts` (new) | Template-level unit tests |
| `tests/unit/manual-golden.test.ts` (new) | Snapshot tests over every shipped `.demo` |
| `tests/integration/cli-manual.test.ts` (new) | End-to-end CLI test |
| `tests/fixtures/manual/*.manual.md` (new, generated then committed) | Golden snapshots, one per shipped demo |

---

## Task 1: Scaffold the emitter (signature, types, trivial passing test)

**Files:**
- Create: `src/core/manual.ts`
- Create: `tests/unit/manual.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/manual.test.ts
import { describe, it, expect } from "vitest";
import { emitManual } from "../../src/core/manual.js";
import type { DemoAst } from "../../src/types.js";

const TTS = { provider: "edge" as const, voice: "x", rate: "+0%", music_duck: true };

function ast(partial: Partial<DemoAst> = {}): DemoAst {
  return {
    frontmatter: { title: "T", url: "u", tts: TTS, ...(partial.frontmatter ?? {}) },
    scenes: partial.scenes ?? [],
  };
}

describe("emitManual", () => {
  it("returns markdown and warnings", () => {
    const out = emitManual(ast());
    expect(typeof out.markdown).toBe("string");
    expect(Array.isArray(out.warnings)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: FAIL — `Cannot find module 'src/core/manual.js'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/core/manual.ts
import type { DemoAst } from "../types.js";

export interface ManualWarning {
  /** 1-based source line that produced the warning. */
  line: number;
  /** Short, human-readable explanation. */
  detail: string;
}

export interface ManualOutput {
  markdown: string;
  warnings: ManualWarning[];
}

export function emitManual(_ast: DemoAst): ManualOutput {
  return { markdown: "", warnings: [] };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): scaffold emitter signature + types"
```

---

## Task 2: Frontmatter rendering (title, optional description, URL)

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/manual.test.ts`:

```ts
describe("frontmatter rendering", () => {
  it("emits H1 title, italic description, and URL line", () => {
    const out = emitManual(ast({
      frontmatter: { title: "Loomly Tour", description: "A walkthrough", url: "http://localhost:8765/", tts: TTS },
    }));
    expect(out.markdown).toContain("# Loomly Tour");
    expect(out.markdown).toContain("*A walkthrough*");
    expect(out.markdown).toContain("**URL:** http://localhost:8765/");
  });

  it("omits the italic description line when description is absent", () => {
    const out = emitManual(ast({
      frontmatter: { title: "T", url: "u", tts: TTS },
    }));
    expect(out.markdown).not.toMatch(/^\*/m);
    expect(out.markdown).toContain("# T");
    expect(out.markdown).toContain("**URL:** u");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 new failures (markdown is empty string).

- [ ] **Step 3: Implement frontmatter rendering**

Replace the body of `emitManual` in `src/core/manual.ts`:

```ts
export function emitManual(ast: DemoAst): ManualOutput {
  const warnings: ManualWarning[] = [];
  const lines: string[] = [];

  lines.push(`# ${ast.frontmatter.title}`);
  lines.push("");
  if (ast.frontmatter.description) {
    lines.push(`*${ast.frontmatter.description}*`);
    lines.push("");
  }
  lines.push(`**URL:** ${ast.frontmatter.url}`);
  lines.push("");

  return { markdown: lines.join("\n"), warnings };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): emit frontmatter (title, description, URL)"
```

---

## Task 3: Slug function for anchor IDs

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
import { slug } from "../../src/core/manual.js";

describe("slug", () => {
  it("lowercases and hyphenates words", () => {
    expect(slug("Open the new-project dialog")).toBe("open-the-new-project-dialog");
  });
  it("strips punctuation", () => {
    expect(slug("Welcome back, Alex!")).toBe("welcome-back-alex");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slug("A & B (test)")).toBe("a-b-test");
  });
  it("falls back to 'untitled' for empty or all-symbol input", () => {
    expect(slug("")).toBe("untitled");
    expect(slug("---")).toBe("untitled");
    expect(slug("!@#$")).toBe("untitled");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 4 failures (`slug` not exported).

- [ ] **Step 3: Implement `slug`**

Add to `src/core/manual.ts` (above `emitManual`):

```ts
export function slug(input: string): string {
  const out = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out.length === 0 ? "untitled" : out;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): add slug() helper for anchor IDs"
```

---

## Task 4: Scene H2 with anchor, plus TOC

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
import type { Scene } from "../../src/types.js";

function scene(title: string, overrides: Partial<Scene> = {}): Scene {
  return {
    sourceLine: 1,
    title,
    prose: "",
    overlays: [],
    steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }],
    ...overrides,
  };
}

describe("scene rendering", () => {
  it("emits a TOC with anchored scene links", () => {
    const out = emitManual(ast({
      scenes: [scene("Welcome back, Alex"), scene("Browse the list")],
    }));
    expect(out.markdown).toContain("## Contents");
    expect(out.markdown).toContain("1. [Welcome back, Alex](#1-welcome-back-alex)");
    expect(out.markdown).toContain("2. [Browse the list](#2-browse-the-list)");
  });

  it("emits an H2 with a matching anchor for each scene", () => {
    const out = emitManual(ast({ scenes: [scene("Welcome back, Alex")] }));
    expect(out.markdown).toContain(`<a id="1-welcome-back-alex"></a>`);
    expect(out.markdown).toContain(`## 1. Welcome back, Alex`);
  });

  it("includes a horizontal rule between the TOC and the scenes", () => {
    const out = emitManual(ast({ scenes: [scene("S")] }));
    const i = out.markdown.indexOf("## Contents");
    const j = out.markdown.indexOf("---", i);
    const k = out.markdown.indexOf("## 1.", j);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 3 new failures.

- [ ] **Step 3: Implement TOC + scene H2**

Update `src/core/manual.ts`:

```ts
import type { DemoAst, Scene } from "../types.js";

// ... ManualWarning / ManualOutput / slug unchanged ...

export function emitManual(ast: DemoAst): ManualOutput {
  const warnings: ManualWarning[] = [];
  const lines: string[] = [];

  // ---- frontmatter ----
  lines.push(`# ${ast.frontmatter.title}`);
  lines.push("");
  if (ast.frontmatter.description) {
    lines.push(`*${ast.frontmatter.description}*`);
    lines.push("");
  }
  lines.push(`**URL:** ${ast.frontmatter.url}`);
  lines.push("");

  // ---- table of contents ----
  if (ast.scenes.length > 0) {
    lines.push("## Contents");
    lines.push("");
    ast.scenes.forEach((s, i) => {
      const n = i + 1;
      lines.push(`${n}. [${s.title}](#${n}-${slug(s.title)})`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ---- scenes ----
  ast.scenes.forEach((s, i) => {
    const n = i + 1;
    lines.push(`## ${n}. ${s.title} <a id="${n}-${slug(s.title)}"></a>`);
    lines.push("");
  });

  return { markdown: lines.join("\n"), warnings };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): emit TOC and scene H2 anchors"
```

---

## Task 5: Scene standalone prose

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe("scene standalone prose", () => {
  it("renders scene prose verbatim under the H2", () => {
    const out = emitManual(ast({
      scenes: [scene("S", { prose: "Some intro text.\n\nA second paragraph." })],
    }));
    expect(out.markdown).toContain("Some intro text.");
    expect(out.markdown).toContain("A second paragraph.");
  });

  it("emits nothing extra when prose is empty", () => {
    const out = emitManual(ast({ scenes: [scene("S", { prose: "" })] }));
    // No prose paragraphs sneak in: only headings, TOC, URL, anchors.
    expect(out.markdown).not.toMatch(/^\S.*\S$/m); // (allow heading + meta only)
  });
});
```

The second assertion above is fragile; replace it with a precise check after seeing what the output looks like. For now, use this simpler form:

```ts
  it("does not add a prose block when prose is empty", () => {
    const withProse = emitManual(ast({ scenes: [scene("S", { prose: "Hi." })] }));
    const without = emitManual(ast({ scenes: [scene("S", { prose: "" })] }));
    expect(withProse.markdown.length).toBeGreaterThan(without.markdown.length);
    expect(without.markdown).not.toContain("Hi.");
  });
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 new failures.

- [ ] **Step 3: Implement prose rendering**

Inside `emitManual`'s scene loop in `src/core/manual.ts`, replace the body:

```ts
  ast.scenes.forEach((s, i) => {
    const n = i + 1;
    lines.push(`## ${n}. ${s.title} <a id="${n}-${slug(s.title)}"></a>`);
    lines.push("");
    if (s.prose.trim()) {
      lines.push(s.prose.trim());
      lines.push("");
    }
  });
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): emit scene standalone prose"
```

---

## Task 6: Step H3 (explicit `fx.step` only; implicit preamble has no H3)

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
import type { Step } from "../../src/types.js";

function step(overrides: Partial<Step> = {}): Step {
  return {
    says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [],
    ...overrides,
  };
}

describe("step rendering", () => {
  it("emits H3 for each fx.step (preamble step is implicit, no H3)", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step(),                                       // implicit preamble
          step({ description: "Open the dialog" }),     // explicit
          step({ description: "Submit the form" }),
        ],
      })],
    }));
    expect(out.markdown).toContain("### 1.1 Open the dialog");
    expect(out.markdown).toContain("### 1.2 Submit the form");
    // The implicit preamble does NOT get its own H3.
    expect(out.markdown).not.toMatch(/^### 1\.0/m);
  });

  it("emits no H3 at all when a scene has only the implicit preamble", () => {
    const out = emitManual(ast({
      scenes: [scene("S", { steps: [step()] })],
    }));
    expect(out.markdown).not.toMatch(/^### /m);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 new failures.

- [ ] **Step 3: Implement step H3 rendering**

Inside the scene loop, after the prose block, add:

```ts
    s.steps.forEach((stp, j) => {
      if (j > 0 && stp.description) {
        // Step index: explicit steps are numbered 1.1, 1.2, ... starting from
        // the first explicit step (j === 1 in the AST since steps[0] is the
        // implicit preamble).
        lines.push(`### ${n}.${j} ${stp.description}`);
        lines.push("");
      }
    });
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): emit step H3 for explicit fx.step calls"
```

---

## Task 7: Narration (`fx.say`) as the step's prose paragraph

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
const span = { start: 0, end: 0, line: 1 };

describe("narration (fx.say)", () => {
  it("renders fx.say text as a prose paragraph in the step body", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({ description: "Welcome", says: [{ text: "Hello, friend.", span }] }),
        ],
      })],
    }));
    expect(out.markdown).toContain("Hello, friend.");
  });

  it("renders narration for the implicit preamble step too", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({ says: [{ text: "Preamble narration.", span }] }),
        ],
      })],
    }));
    expect(out.markdown).toContain("Preamble narration.");
  });
});
```

Note: `step()` helper above already exists from Task 6. The `Partial<Step>` accepts a `description` even though `description` isn't strictly assignable through the type spread; cast inside the helper if needed:

```ts
function step(overrides: Partial<Step> = {}): Step {
  return {
    says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [],
    ...overrides,
  };
}
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 failures.

- [ ] **Step 3: Implement narration rendering**

Refactor `src/core/manual.ts` to extract a per-step renderer. Replace the scene loop body's step rendering with calls to a new helper. Add this helper:

```ts
function renderStep(stp: Step, sceneNum: number, stepIdx: number, out: string[]): void {
  // Heading — only for explicit steps (stepIdx > 0 and a description set).
  if (stepIdx > 0 && stp.description) {
    out.push(`### ${sceneNum}.${stepIdx} ${stp.description}`);
    out.push("");
  }
  // Narration (fx.say) — first prose paragraph.
  if (stp.says.length > 0) {
    out.push(stp.says[0].text);
    out.push("");
  }
}
```

And in `emitManual`, replace the inner step loop with:

```ts
    s.steps.forEach((stp, j) => renderStep(stp, n, j, lines));
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): render fx.say narration as step prose"
```

---

## Task 8: Banner (`fx.banner`) as on-screen lead-in when no narration

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe("banner (fx.banner)", () => {
  it("renders banner as 'On-screen:' lead-in when there is no fx.say in the step", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({ banners: [{ text: "Welcome to the tour.", span }] }),
        ],
      })],
    }));
    expect(out.markdown).toContain("**On-screen:** Welcome to the tour.");
  });

  it("drops banner when fx.say is also present in the same step (say wins)", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            says: [{ text: "Spoken narration.", span }],
            banners: [{ text: "Welcome.", span }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toContain("Spoken narration.");
    expect(out.markdown).not.toContain("**On-screen:** Welcome.");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 failures.

- [ ] **Step 3: Implement banner rendering**

In `renderStep`, after the narration block:

```ts
  if (stp.says.length === 0 && stp.banners.length > 0) {
    out.push(`**On-screen:** ${stp.banners[0].text}`);
    out.push("");
  }
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): render fx.banner as on-screen lead-in when no narration"
```

---

## Task 9: Action source-ordering helper

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

This task introduces the internal `ActionRow` representation and the source-order sort. No user-visible output yet; subsequent tasks (10–14) use it to emit per-action sentences.

- [ ] **Step 1: Add failing tests**

Append:

```ts
import { actionsInSourceOrder } from "../../src/core/manual.js";

describe("actionsInSourceOrder", () => {
  it("interleaves clicks, types, highlights, cursors by source line", () => {
    const s = step({
      clicks:     [{ selector: "#a", selectorSpan: { start: 0, end: 0, line: 30 },
                     description: "A button", descriptionSpan: { start: 0, end: 0, line: 30 } }],
      types:      [{ text: "hello", span: { start: 0, end: 0, line: 20 } }],
      highlights: [{ selector: "#h", selectorSpan: { start: 0, end: 0, line: 10 },
                     description: "Highlighted area", descriptionSpan: { start: 0, end: 0, line: 10 } }],
      cursors:    [{ selector: "#c", selectorSpan: { start: 0, end: 0, line: 40 },
                     description: "Cursor target", descriptionSpan: { start: 0, end: 0, line: 40 } }],
    });
    const rows = actionsInSourceOrder(s);
    expect(rows.map((r) => r.kind)).toEqual(["highlight", "type", "click", "cursor"]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 1 failure.

- [ ] **Step 3: Implement `actionsInSourceOrder`**

Add to `src/core/manual.ts`:

```ts
export type ActionRow =
  | { kind: "click"; selector: string; description: string; line: number }
  | { kind: "highlight"; selector: string; description: string; line: number }
  | { kind: "cursor"; selector: string; description: string; line: number }
  | { kind: "type"; text: string; line: number };

export function actionsInSourceOrder(stp: Step): ActionRow[] {
  const rows: ActionRow[] = [
    ...stp.clicks.map((a): ActionRow => ({
      kind: "click", selector: a.selector, description: a.description, line: a.selectorSpan.line,
    })),
    ...stp.highlights.map((a): ActionRow => ({
      kind: "highlight", selector: a.selector, description: a.description, line: a.selectorSpan.line,
    })),
    ...stp.cursors.map((a): ActionRow => ({
      kind: "cursor", selector: a.selector, description: a.description, line: a.selectorSpan.line,
    })),
    ...stp.types.map((t): ActionRow => ({
      kind: "type", text: t.text, line: t.span.line,
    })),
  ];
  return rows.sort((a, b) => a.line - b.line);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): actionsInSourceOrder() merges step actions by source line"
```

---

## Task 10: Click template (with description) and cursor+click fold

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe("click action template", () => {
  it("renders 'Click **<description>**.' for fx.click with description", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            clicks: [{
              selector: "[data-testid=new]",
              selectorSpan: { start: 0, end: 0, line: 10 },
              description: "the new project button",
              descriptionSpan: { start: 0, end: 0, line: 10 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Click \*\*the new project button\*\*\./);
  });

  it("folds fx.cursorTo + fx.click on the same selector into a single click line", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            cursors: [{
              selector: "[data-testid=new]",
              selectorSpan: { start: 0, end: 0, line: 9 },
              description: "the new project button",
              descriptionSpan: { start: 0, end: 0, line: 9 },
            }],
            clicks: [{
              selector: "[data-testid=new]",
              selectorSpan: { start: 0, end: 0, line: 11 },
              description: "the new project button",
              descriptionSpan: { start: 0, end: 0, line: 11 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Click \*\*the new project button\*\*\./);
    expect(out.markdown).not.toMatch(/Look at /);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 failures.

- [ ] **Step 3: Implement the action loop with click + fold**

Add a new helper inside `src/core/manual.ts`:

```ts
function renderActions(stp: Step, _sceneNum: number, _stepIdx: number, out: string[], warnings: ManualWarning[]): void {
  const rows = actionsInSourceOrder(stp);
  // Fold: drop cursors whose selector also has a click in the same step.
  const clickSelectors = new Set(rows.filter((r) => r.kind === "click").map((r) => r.selector));
  const visible = rows.filter((r) => !(r.kind === "cursor" && clickSelectors.has(r.selector)));

  visible.forEach((r, idx) => {
    const n = idx + 1;
    let sentence = "";
    if (r.kind === "click") {
      sentence = `${n}. Click **${r.description}**.`;
    } else {
      return; // remaining kinds handled in later tasks
    }
    out.push(sentence);
  });
  if (visible.some((r) => r.kind === "click")) {
    out.push("");
  }
  void warnings; // unused until Task 11
}
```

Call it from `renderStep` right after the banner block:

```ts
  renderActions(stp, sceneNum, stepIdx, out, /* warnings */ /* see Task 16 */ [] as ManualWarning[]);
```

Hold on — `renderStep` needs access to the warnings array so that bare `page.click` warnings (Task 11) and any future warnings can be collected. Update `renderStep` and its callers to thread `warnings` through:

```ts
function renderStep(
  stp: Step,
  sceneNum: number,
  stepIdx: number,
  out: string[],
  warnings: ManualWarning[],
): void {
  if (stepIdx > 0 && stp.description) {
    out.push(`### ${sceneNum}.${stepIdx} ${stp.description}`);
    out.push("");
  }
  if (stp.says.length > 0) {
    out.push(stp.says[0].text);
    out.push("");
  }
  if (stp.says.length === 0 && stp.banners.length > 0) {
    out.push(`**On-screen:** ${stp.banners[0].text}`);
    out.push("");
  }
  renderActions(stp, sceneNum, stepIdx, out, warnings);
}
```

And in `emitManual`:

```ts
    s.steps.forEach((stp, j) => renderStep(stp, n, j, lines, warnings));
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): render click action sentences with cursor+click folding"
```

---

## Task 11: Click without description (warning + fallback)

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe("page.click without description", () => {
  it("renders fallback text and records a warning", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        sourceLine: 5,
        steps: [
          step({
            clicks: [{
              selector: "button.primary",
              selectorSpan: { start: 0, end: 0, line: 42 },
              description: "",
              descriptionSpan: { start: 0, end: 0, line: 42 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Click the target element\. \*\(no description — line 42\)\*/);
    expect(out.warnings).toEqual([
      { line: 42, detail: "click has no description (selector: button.primary)" },
    ]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 1 failure.

- [ ] **Step 3: Update the click branch in `renderActions`**

Replace the `if (r.kind === "click")` branch:

```ts
    if (r.kind === "click") {
      if (r.description) {
        sentence = `${n}. Click **${r.description}**.`;
      } else {
        sentence = `${n}. Click the target element. *(no description — line ${r.line})*`;
        warnings.push({
          line: r.line,
          detail: `click has no description (selector: ${r.selector})`,
        });
      }
    } else {
      return;
    }
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): warn and fall back when click has no description"
```

---

## Task 12: typeWithDelay template

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe("typeWithDelay template", () => {
  it("renders 'Type **\"<text>\"**.'", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            types: [{ text: "Holiday landing page", span: { start: 0, end: 0, line: 50 } }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Type \*\*"Holiday landing page"\*\*\./);
  });

  it("escapes embedded double-quotes in the typed text", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            types: [{ text: 'A "quoted" word', span: { start: 0, end: 0, line: 51 } }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toContain('Type **"A \\"quoted\\" word"**.');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 failures.

- [ ] **Step 3: Extend the action loop**

Replace the early `return` for non-click kinds with branches per kind. In `renderActions`, change the `else { return; }` block:

```ts
    if (r.kind === "click") {
      // (existing click branch)
    } else if (r.kind === "type") {
      sentence = `${n}. Type **"${r.text.replace(/"/g, '\\"')}"**.`;
    } else {
      return; // highlight, cursor handled in later tasks
    }
    out.push(sentence);
```

And update the trailing newline condition to fire when *any* row was emitted, not only clicks:

```ts
  if (visible.some((r) => r.kind === "click" || r.kind === "type")) {
    out.push("");
  }
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): render typeWithDelay sentences"
```

---

## Task 13: Highlight and cursorTo (solo) templates

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe("highlight + cursorTo templates", () => {
  it("renders 'Notice **<description>**.' for fx.highlight", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            highlights: [{
              selector: ".stats",
              selectorSpan: { start: 0, end: 0, line: 60 },
              description: "the stats panel",
              descriptionSpan: { start: 0, end: 0, line: 60 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Notice \*\*the stats panel\*\*\./);
  });

  it("renders 'Look at **<description>**.' for a solo fx.cursorTo (no matching click in step)", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            cursors: [{
              selector: "[data-testid=row-2]",
              selectorSpan: { start: 0, end: 0, line: 70 },
              description: "the Q3 launch row",
              descriptionSpan: { start: 0, end: 0, line: 70 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toMatch(/Look at \*\*the Q3 launch row\*\*\./);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 failures.

- [ ] **Step 3: Extend the action loop**

Add `highlight` and `cursor` branches:

```ts
    } else if (r.kind === "highlight") {
      sentence = `${n}. Notice **${r.description}**.`;
    } else if (r.kind === "cursor") {
      sentence = `${n}. Look at **${r.description}**.`;
    } else {
      return;
    }
```

And update the trailing newline check to include all four kinds:

```ts
  if (visible.length > 0) {
    out.push("");
  }
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): render highlight and solo cursorTo sentences"
```

---

## Task 14: Overlay → blockquote

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

Overlays in the AST are stored at the **scene** level (`scene.overlays`), not on a particular step. For the manual, render them as a blockquote section under the scene, after all steps.

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe("overlay rendering", () => {
  it("renders callout/highlight overlays with text as blockquotes after the steps", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        overlays: [
          { type: "callout", target: ".stats", text: "Three quick stats up top", duration: "2.5s" },
          { type: "highlight", target: ".x", duration: "1s" }, // no text → skipped
        ],
        steps: [step()],
      })],
    }));
    expect(out.markdown).toContain("> Three quick stats up top");
    expect(out.markdown.match(/^> /gm)?.length ?? 0).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 1 failure.

- [ ] **Step 3: Implement overlay rendering**

In `emitManual`'s scene loop, after `s.steps.forEach(...)`:

```ts
    const overlayTexts = s.overlays
      .map((o) => (typeof o.text === "string" ? o.text.trim() : ""))
      .filter((t) => t.length > 0);
    overlayTexts.forEach((t) => {
      lines.push(`> ${t}`);
    });
    if (overlayTexts.length > 0) {
      lines.push("");
    }
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): render overlay callouts as blockquotes"
```

---

## Task 15: End-of-file warning list

**Files:**
- Modify: `src/core/manual.ts`
- Modify: `tests/unit/manual.test.ts`

- [ ] **Step 1: Add failing tests**

Append:

```ts
describe("warning list", () => {
  it("appends a 'Warnings' section at the end when warnings were collected", () => {
    const out = emitManual(ast({
      scenes: [scene("S", {
        steps: [
          step({
            clicks: [{
              selector: "button.primary",
              selectorSpan: { start: 0, end: 0, line: 42 },
              description: "",
              descriptionSpan: { start: 0, end: 0, line: 42 },
            }],
          }),
        ],
      })],
    }));
    expect(out.markdown).toContain("## Warnings");
    expect(out.markdown).toContain("- line 42: click has no description (selector: button.primary)");
  });

  it("omits the 'Warnings' section entirely when there are no warnings", () => {
    const out = emitManual(ast({ scenes: [scene("S")] }));
    expect(out.markdown).not.toContain("## Warnings");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: 2 failures.

- [ ] **Step 3: Append the Warnings section**

At the very end of `emitManual`, before the return:

```ts
  if (warnings.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const w of warnings) {
      lines.push(`- line ${w.line}: ${w.detail}`);
    }
    lines.push("");
  }

  return { markdown: lines.join("\n"), warnings };
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/unit/manual.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/manual.ts tests/unit/manual.test.ts
git commit -m "feat(manual): append warning list at end of manual.md"
```

---

## Task 16: Golden snapshots for every shipped `.demo`

**Files:**
- Create: `tests/unit/manual-golden.test.ts`
- Create: `tests/fixtures/manual/{demo-tour,wikipedia-tour,hacker-news-tour,screenassist-app-tour,screenassist-tour}.manual.md` (generated)

This task locks the per-file output. The standard TDD cycle is inverted because the golden files don't exist yet — generate them once, eyeball each one, commit.

- [ ] **Step 1: Create the snapshot test (will fail because fixtures don't exist yet)**

```ts
// tests/unit/manual-golden.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parse } from "../../src/parser.js";
import { emitManual } from "../../src/core/manual.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SHIPPED_DEMOS = [
  "demo-tour.demo",
  "wikipedia-tour.demo",
  "hacker-news-tour.demo",
  "screenassist-app-tour.demo",
  "screenassist-tour.demo",
];

describe("manual golden snapshots", () => {
  for (const filename of SHIPPED_DEMOS) {
    it(`matches the golden for ${filename}`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, filename), "utf8");
      const fixtureName = filename.replace(/\.demo$/, ".manual.md");
      const fixturePath = path.join(REPO_ROOT, "tests", "fixtures", "manual", fixtureName);
      const actual = emitManual(parse(src)).markdown;
      const expected = fs.readFileSync(fixturePath, "utf8");
      expect(actual).toBe(expected);
    });
  }
});
```

- [ ] **Step 2: Run the test, verify all five fail with ENOENT**

Run: `npx vitest run tests/unit/manual-golden.test.ts`
Expected: 5 failures, each reading "ENOENT … tests/fixtures/manual/…".

- [ ] **Step 3: Generate the fixtures from the current emitter output**

Build the TS to `dist/`, then run a small Node script. From the repo root:

```bash
npm run build
mkdir -p tests/fixtures/manual
for f in demo-tour wikipedia-tour hacker-news-tour screenassist-app-tour screenassist-tour; do
  node --input-type=module -e "
    import fs from 'node:fs';
    const { parse } = await import('./dist/parser.js');
    const { emitManual } = await import('./dist/core/manual.js');
    const src = fs.readFileSync('$f.demo', 'utf8');
    fs.writeFileSync('tests/fixtures/manual/$f.manual.md', emitManual(parse(src)).markdown);
  "
done
```

This relies on `dist/` produced by `npm run build` (which compiles TS to ESM JS); no extra dev deps required.

- [ ] **Step 4: Eyeball each generated `.manual.md` for sanity**

Open each file in `tests/fixtures/manual/` and confirm:
- Title, description, URL render at the top.
- Each scene has an H2, TOC entry, optional standalone prose.
- Steps render with their narration and action sentences.
- For `demo-tour.demo` (which uses `page.click` without descriptions): a `## Warnings` section appears at the end.

If the output looks wrong, fix the emitter (not the fixtures) and regenerate.

- [ ] **Step 5: Run the snapshot tests, verify all five pass**

Run: `npx vitest run tests/unit/manual-golden.test.ts`
Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/manual-golden.test.ts tests/fixtures/manual/
git commit -m "test(manual): golden snapshots for all shipped .demo files"
```

---

## Task 17: CLI command `daymo manual`

**Files:**
- Create: `src/commands/manual.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the command handler**

```ts
// src/commands/manual.ts
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
```

- [ ] **Step 2: Register the command in `src/cli.ts`**

Add the import near the other command imports:

```ts
import { manualCommand } from "./commands/manual.js";
```

Add the command registration after `migrateProseCommand` (around line 58):

```ts
cli.command("manual <file>", "Generate manual.md from a .demo file (no browser, no screenshots)")
  .option("--out <path>", "Custom output path (default: manual.md next to the .demo file)")
  .option("--stdout", "Print to stdout instead of writing a file")
  .action((file: string, flags: { out?: string; stdout?: boolean }) =>
    manualCommand(file, { out: flags.out, stdout: flags.stdout }),
  );
```

- [ ] **Step 3: Build and smoke-test manually**

Run:

```bash
npm run build
node dist/cli.js manual demo-tour.demo --stdout | head -30
```

Expected: the first 30 lines of the generated manual print to stdout.

Then:

```bash
node dist/cli.js manual demo-tour.demo
```

Expected: stderr shows warnings for `page.click` calls without descriptions; stdout prints the absolute path of `demo-tour-manual.md` — and that file appears next to `demo-tour.demo` in the repo root. Wait — by the spec, the output file is `manual.md` next to the .demo. Confirm the file is `<demo-dir>/manual.md`, not `<demo-name>-manual.md`.

Open the file and verify it matches the golden fixture from Task 16.

- [ ] **Step 4: Delete the smoke-test artifact (it shouldn't be committed)**

```bash
rm -f manual.md
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/manual.ts src/cli.ts
git commit -m "feat(cli): add 'daymo manual' command"
```

---

## Task 18: End-to-end CLI integration test

**Files:**
- Create: `tests/integration/cli-manual.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// tests/integration/cli-manual.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

const SAMPLE = `---
title: tiny
url: about:blank
---

# Hello

\`\`\`playwright
await fx.say("Welcome to the tour.");
await fx.click("button.primary", "the primary button");
await fx.typeWithDelay("input.name", "Holiday landing page");
\`\`\`
`;

const SAMPLE_WITH_WARNING = `---
title: tiny-warn
url: about:blank
---

# Hello

\`\`\`playwright
await page.click("button.primary");
\`\`\`
`;

describe("daymo manual", () => {
  it("writes manual.md next to the source .demo by default", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, SAMPLE);

    const { exitCode } = await execa("node", [cliBin, "manual", file]);
    expect(exitCode).toBe(0);

    const md = await fs.readFile(path.join(dir, "manual.md"), "utf8");
    expect(md).toContain("# tiny");
    expect(md).toContain("Welcome to the tour.");
    expect(md).toContain("Click **the primary button**.");
    expect(md).toContain('Type **"Holiday landing page"**.');
  });

  it("respects --out", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-out-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, SAMPLE);
    const customOut = path.join(dir, "custom", "guide.md");
    await fs.mkdir(path.dirname(customOut), { recursive: true });

    const { exitCode } = await execa("node", [cliBin, "manual", file, "--out", customOut]);
    expect(exitCode).toBe(0);
    expect((await fs.stat(customOut)).isFile()).toBe(true);
    await expect(fs.stat(path.join(dir, "manual.md"))).rejects.toThrow(); // not written
  });

  it("prints to stdout when --stdout is set and writes no file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-stdout-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, SAMPLE);

    const { exitCode, stdout } = await execa("node", [cliBin, "manual", file, "--stdout"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# tiny");
    expect(stdout).toContain("Click **the primary button**.");
    await expect(fs.stat(path.join(dir, "manual.md"))).rejects.toThrow();
  });

  it("emits warnings to stderr for bare page.click without description", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-warn-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, SAMPLE_WITH_WARNING);

    const { exitCode, stderr } = await execa("node", [cliBin, "manual", file]);
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/warning: line \d+: click has no description/);
    const md = await fs.readFile(path.join(dir, "manual.md"), "utf8");
    expect(md).toContain("## Warnings");
  });

  it("exits non-zero on a missing input file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-missing-"));
    const file = path.join(dir, "does-not-exist.demo");
    const { exitCode, stderr } = await execa("node", [cliBin, "manual", file], { reject: false });
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/ENOENT|no such file/i);
  });
});
```

- [ ] **Step 2: Build and run the test**

Run:

```bash
npm run build && npx vitest run tests/integration/cli-manual.test.ts
```

Expected: 5 PASS.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: all PASS (existing tests + new unit + new golden + new integration).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/cli-manual.test.ts
git commit -m "test(cli): integration tests for daymo manual"
```

---

## Self-Review Notes

This plan was checked against the spec:

- ✓ One new command (`daymo manual <file>`) — Task 17.
- ✓ Output `manual.md` next to the source — Task 17 default path.
- ✓ `--out` and `--stdout` flags — Task 17, verified in Task 18.
- ✓ Pure-AST emitter, no browser, no screenshots, no new fx methods — Tasks 1–15.
- ✓ Frontmatter (title, optional description, URL) — Task 2.
- ✓ TOC with anchored links — Task 4.
- ✓ Scene H2 + anchor + standalone prose — Tasks 4, 5.
- ✓ Step H3 only for explicit `fx.step` — Task 6.
- ✓ Narration paragraph — Task 7.
- ✓ Banner lead-in only when no narration — Task 8.
- ✓ Action templates (click, click-without-desc, type, highlight, cursor-solo) — Tasks 10, 11, 12, 13.
- ✓ Cursor + click fold by matching selector in same step — Task 10.
- ✓ Overlay callouts as blockquotes; empty-text overlays skipped — Task 14.
- ✓ Warnings collected + end-of-file warning list + printed to stderr — Tasks 11, 15, 17.
- ✓ Golden snapshots for every shipped `.demo` — Task 16.
- ✓ Slug function with deterministic `untitled` fallback — Task 3.

No placeholders. No "TODO" or "implement later" steps. Every code-changing step contains the actual code.
