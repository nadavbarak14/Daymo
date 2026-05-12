# Multi-step scenes: narrative breakdown inside a scene

## Motivation

Today a `.demo` scene maps to one editor row with a single editable caption. The actual playwright block — clicks, cursor moves, says, waits — is invisible in the editor. For long demos (a 20-minute walkthrough lives perfectly well as a single scene) this means there is no way to navigate, comment on, or edit a specific moment inside the recording without scrolling raw JavaScript.

We want each scene to be visually decomposable into author-defined narrative chunks ("steps"), each holding multiple statements (a click + cursor + say + wait can all belong to one step), each with a free-text description, an optional inline subtitle / banner that the editor exposes for editing, and its own comment slot.

This is purely an authoring-and-editor change. The rendered video is unchanged.

## Format change

Add one new primitive to the `fx` runtime:

```ts
fx.step(description: string): Promise<void>
```

A call to `fx.step("…")` opens a new step. Every subsequent statement, up to the next `fx.step` call (or the end of the playwright block), belongs to that step. `description` must be a **string literal**, same constraint as `fx.say` and `fx.banner`.

The runtime impl logs a `step` event into `events.json` and resolves immediately. **No visual effect on the recorded video** — the description text never appears on screen; it exists for editor visualization and as runtime telemetry.

Example:

```js
await fx.step("Open the new-project dialog");
await fx.cursorTo("[data-testid=new-project-btn]");
await page.click("[data-testid=new-project-btn]");
await fx.say("Click here to start a new project.");
await page.waitForSelector("[role=dialog]");

await fx.step("Fill in the project name");
await page.fill("[name=projectName]", "My first project");
await fx.say("Give it a name.");
```

A scene that opens with statements before any `fx.step` call gets an implicit "preamble" step with `description === undefined` covering everything up to the first explicit step. This keeps existing `.demo` files valid — adoption of `fx.step` is optional, not retroactively required.

## Invariants

Enforced at parse time. Violations throw with a message that names the scene title, step description, and offending source line; surfaced in editor Errors tab and in `daymo render`/`capture` CLI output.

1. **`fx.step` argument must be a string literal.** Mirrors the existing `fx.say` rule. AST walker rejects template literals, variables, expressions, and missing-argument forms (`fx.step()`).
2. **At most one `fx.say` per step.** If a step needs two narrations, split it into two steps. Encourages narrative discipline and keeps the editor row layout one-subtitle-per-row.
3. **At most one `fx.banner` per step.** Same rationale.

`fx.say` and `fx.banner` may coexist in the same step (one of each is fine; they target different surfaces). Steps with zero say and zero banner are fine — pure-action steps are common.

## Parser & data model

### Types (`src/types.ts`)

```ts
export interface SourceSpan {
  start: number;  // byte offset within the .demo file
  end: number;    // exclusive
  line: number;   // 1-based, for error messages
}

export interface StepLiteral {
  text: string;
  span: SourceSpan;
}

export interface Step {
  /** undefined for the implicit preamble that wraps statements before the first fx.step. */
  description?: string;
  descriptionSpan?: SourceSpan;
  /** 0 or 1 entries (invariant 2). */
  says: StepLiteral[];
  /** 0 or 1 entries (invariant 3). */
  banners: StepLiteral[];
}

export interface Scene {
  // existing fields unchanged
  sourceLine: number;
  title: string;
  prose: string;
  playwrightCode?: { code: string; sourceLine: number };
  overlays: OverlayDirective[];
  /** Always length >= 1. First entry may be the implicit preamble. */
  steps: Step[];
}
```

`SourceSpan` offsets are anchored to **the full .demo file**, not the playwright code substring. The parser is responsible for translating from babel/acorn's in-code offsets into file offsets by adding the playwright fence start offset. This makes the rewrite path a pure byte-range splice on the source file.

### Walker (`src/tts/scan.ts` extension)

The existing `scanFxSayLiterals` walker is generalized into a single pass that emits an in-source-order list:

```ts
type StepEvent =
  | { kind: "step"; text: string; span: SourceSpan }
  | { kind: "say"; text: string; span: SourceSpan }
  | { kind: "banner"; text: string; span: SourceSpan };

function scanStepEvents(code: string, fenceStartOffset: number, fenceStartLine: number): StepEvent[]
```

The parser then folds the event list into `Step[]`:

```
1. Open an implicit preamble step (description undefined).
2. For each event:
   - "step" -> close current step, open new step with description = event.text.
   - "say"  -> append to current step's says.
   - "banner" -> append to current step's banners.
3. Validate invariants 2 and 3 after each event (throw on second say/banner in a step).
```

`scanFxSayLiterals` keeps its existing public signature as a thin wrapper for the TTS pre-synthesis path (which only needs `say` literals).

### Persisted state

`.daymo/state.json` is **not** changed. Steps are derived from source on every load — they aren't capture state. Existing fields (`state`, `webmPath`, `eventsPath`, etc.) stay as-is.

## Source rewriting

A new helper in `src/core/rewrite.ts`:

```ts
async function rewriteLiteralAt(file: string, span: SourceSpan, newText: string): Promise<void>
```

Implementation:
1. Read file bytes.
2. JSON-encode `newText` (handles quotes, escapes, unicode).
3. Splice: `bytes[0..span.start] + encoded + bytes[span.end..]`. `span.start` is the opening quote of the literal; `span.end` is exclusive of the byte after the closing quote. JSON-encoding produces a `"…"` form so the replacement preserves quote balance with no fix-up.
4. Atomic write (temp file + rename, matching existing rewrite patterns in `src/core/rewrite.ts`).

Span boundaries point to the literal *including* its surrounding quotes — JSON-encoding the replacement produces a balanced quoted form, so the rewrite is a clean byte-range replacement with no fix-up.

All three editable fields (step description, say, banner) flow through `rewriteLiteralAt`. The existing line-based `set-prose` rewrite is untouched.

After a rewrite, the file watcher fires, parser re-runs, SSE broadcasts a fresh state. Captures for the affected scene are invalidated via the existing `scene-changed` action.

The TTS cache is content-addressed: editing an `fx.say` literal changes the cache hash, so the next capture naturally re-synthesizes. No explicit cache invalidation needed.

## Controller / runtime

`src/controller.ts` adds `fx.step` to the `DemoFx` impl:

```ts
async step(description: string): Promise<void> {
  emit({ kind: "step", t: now(), sceneIndex, stepIndex, description });
}
```

`RunnerEvent` in `src/types.ts` gains:

```ts
| { kind: "step"; t: number; sceneIndex: number; stepIndex: number; description: string }
```

`stepIndex` matches the index in `scene.steps[]`. The implicit preamble occupies `steps[0]` in the AST but emits **no** step event (it has no description). The first explicit `fx.step(...)` call lives at `steps[1]` and emits `step` event with `stepIndex: 1`; the next is `steps[2]` with `stepIndex: 2`; and so on. If a scene has no implicit preamble work (its first statement is `fx.step(...)`), `steps[0]` is still present as an empty preamble entry — keeping the "first explicit step is at index 1" invariant stable across scenes.

## Editor API

One new endpoint:

```
POST /api/step
Body: {
  sceneIndex: number;
  stepIndex: number;
  kind: "description" | "say" | "banner";
  text: string;
}
Response: 200 { ok: true }  |  400 { error: "..." }
```

Handler resolves the target span from the current parsed AST (`state.scenes[sceneIndex].steps[stepIndex].descriptionSpan` / `.says[0].span` / `.banners[0].span`), then calls `rewriteLiteralAt`. The file watcher handles the rest.

Editing the description of an implicit preamble (which has no `descriptionSpan`) returns 400 with `"cannot edit preamble description — add an explicit fx.step() call first"`. (Adding new code to a step is out of scope for v1; see "Out of scope".)

`POST /api/script` (existing scene-prose rewrite) stays unchanged.

## Editor UI

### State shape

`SceneRow` gains a `steps: Step[]` field, hydrated from the parser output on every state broadcast.

### `Script.tsx` rewrite

Replace the single contentEditable caption with a list of step rows. Each row renders:

```
┌──────────────────────────────────────────────────────────┐
│ ▸ <editable description>                          [💬]   │
│     Say: <editable subtitle>            (if step has a say)
│     Banner: <editable banner text>      (if step has a banner)
│   Comments on this step · N            (if drafts present)
└──────────────────────────────────────────────────────────┘
```

- Description and inline subtitle/banner use the existing `contentEditable` blur-to-save pattern, calling `POST /api/step` with the right `kind`.
- The implicit preamble step is rendered with a muted "Preamble (no description)" label and only its say/banner are editable.
- The comment composer (`Composer.tsx`) is reused per step.

### Comment storage

`Draft` (in `editor-ui/src/store.ts`) gains an optional `stepIndex` field. `targetKind` extended to include `"step.description" | "step.say" | "step.banner"`. Backcompat: existing `caption` and `overlay` kinds remain for non-multi-step scenes and overlay comments.

`src/editor/prompt.ts` (the review-prompt formatter) grows a new branch that quotes the step description, the affected text, and the comment, in the same shape as today's caption/overlay branches.

## CLI

No new commands. The editor is the primary surface for per-step editing. CLI users who want to mass-edit can still hand-edit the `.demo` source — the format is plain markdown + JS.

The existing `daymo migrate-prose` helper is unchanged. Authors who want to retrofit `fx.step` into an existing demo do it by hand or with their LLM of choice.

## AI-agent authoring docs

The README's "Tips for AI agents authoring `.demo` files" section is extended with a dedicated "Structure long scenes into steps" subsection covering:

1. Wrap each user-visible action in `await fx.step("…")` with a short imperative description ("Open the dialog", "Fill in the project name", "Submit").
2. A step groups *all* the statements that make that action happen — cursor move, click, narration, wait.
3. **Hard rule**: at most one `fx.say` per step. If you'd narrate two distinct lines, split into two steps.
4. **Hard rule**: at most one `fx.banner` per step.
5. `fx.step` description must be a string literal (no template strings, no variables).
6. Skip `fx.step` for trivial single-action scenes — the preamble works fine.

The README "Worked example" section is replaced with a multi-step example that an agent can pattern-match against:

````markdown
---
title: Create your first project
url: http://localhost:3000
mocks:
  - source: inline
    routes:
      "GET /api/me": { "name": "Alex" }
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

The `fx` runtime signature table in the README gains a row for `fx.step`.

## Testing

### Unit

- `tests/unit/scan-steps.test.ts`
  - Walker produces correct event order for a multi-step block.
  - Implicit preamble created when no `fx.step` opens the block.
  - Span offsets are file-absolute and survive a round-trip through `rewriteLiteralAt`.
  - Non-literal `fx.step(varName)` throws with the source line number.
  - Two `fx.say` in one step throws with the step description and source line.
  - Two `fx.banner` in one step throws likewise.

- `tests/unit/rewrite-literal.test.ts`
  - Rewriting a literal containing quotes/newlines produces a valid JSON-encoded replacement.
  - Rewriting one literal does not perturb surrounding code.

### Integration

- `tests/integration/editor-step-api.test.ts`
  - `POST /api/step` with each `kind` rewrites the source.
  - File watcher re-parses; SSE broadcasts the new `steps` array.
  - Attempting to edit a preamble description returns 400.

### E2E

- Extend `tests/e2e/smoke.test.ts` fixture to include one `fx.step` call. Assert `events.json` contains a `step` event with the expected description and `stepIndex`.

### Editor UI

- Component test: `Script.tsx` renders N rows for N steps, including a muted preamble.
- Component test: editing a step description calls `api.setStep(sceneIndex, stepIndex, "description", text)`.

## Migration / backcompat

- Existing `.demo` files without any `fx.step` calls continue to parse: each scene's playwright block becomes a single implicit-preamble step.
- The editor renders such scenes as one (muted, non-editable-description) row containing whatever say/banner literals the scene has. This is strictly better than today's "edit prose only" surface.
- No state-file migration needed.

## Out of scope (v1)

- Adding a new `fx.say` or `fx.banner` to a step that currently has none. (Requires injecting code, not replacing a literal. Defer.)
- Reordering steps from the UI. Defer; hand-edit.
- Splitting / merging steps from the UI. Defer.
- Step-level pauses or visual side effects. `fx.step` stays metadata-only.
- CLI `daymo set-step` command. Editor is the surface.
- Per-step capture / re-capture. Capture remains scene-granular — the runtime can't rewind mid-scene anyway.
