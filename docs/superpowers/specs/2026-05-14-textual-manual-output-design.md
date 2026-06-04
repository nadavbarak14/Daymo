# Textual manual output for `.demo` files

**Date:** 2026-05-14
**Status:** Design approved, ready for plan
**Scope:** Phase 1 — pure-AST Markdown emitter. Phases 2 (DOM-resolved verbatim labels) and 3 (screenshots) are deferred and only built on demonstrated demand.

## Motivation

Daymo turns a `.demo` file into a polished video. Some readers want the same content as skimmable text — to Ctrl-F a button name, to feed it to an LLM that answers questions about the app, or to read offline without playing the video. The data needed for that text already exists in the parsed AST: scene titles, `fx.step` descriptions, `fx.say` narration, `fx.typeWithDelay` payloads, author descriptions on `fx.click` / `fx.highlight` / `fx.cursorTo`, and overlay text. We just don't emit it as Markdown.

## Goals

- Produce a Ctrl-F-able, LLM-readable Markdown manual from any existing `.demo` file with no authoring changes.
- Add one new CLI command. No runtime changes. No new `fx` methods. No new AST fields.
- Cover every shipped `.demo` (`demo-tour.demo`, `wikipedia-tour.demo`, `hacker-news-tour.demo`, `screenassist-app-tour.demo`, `screenassist-tour.demo`) with golden-file snapshots.
- Ship in roughly one day of focused work.

## Non-goals (explicitly deferred)

- DOM-resolved verbatim button labels (Phase 2). Today the manual uses the author's intent description (e.g. "the new project button") rather than the visible label ("+ New project"). This is the largest known fidelity gap and is gated on user feedback.
- Screenshots (Phase 3). When/if needed, source them from `raw_page.webm` via `ffmpeg -ss <t> -i raw_page.webm -frames:v 1` at timestamps already recorded in `events.json`. No second capture pipeline.
- `manual.json` companion output.
- Glossary appendix, label-source tagging, lint pass.
- Slug-based stable identity beyond the scene anchor IDs the TOC needs.
- Chaining into `daymo render` or `daymo capture`. Manual is its own command.
- Any new `fx.*` method (including `fx.typeExample` for distinguishing literal vs example typed values).

## Design

### Architecture

Two new files. Nothing existing changes shape, only `cli.ts` gets one command registration.

```
src/
  core/
    manual.ts        new. emitManual(ast: DemoAst): { markdown: string; warnings: Warning[] }
  commands/
    manual.ts        new. CLI handler: parse → emit → write
  cli.ts             one line added to register `manual`
```

The emitter is a pure function over `DemoAst`. The command handler is the only place that touches the filesystem.

### Output structure

```markdown
# {frontmatter.title}

*{frontmatter.description}*       (italic line omitted if absent)

**URL:** {frontmatter.url}

## Contents

1. [{scene 1 title}](#1-{scene-1-slug})
2. [{scene 2 title}](#2-{scene-2-slug})
...

---

## 1. {scene title} <a id="1-{scene-slug}"></a>

{scene's standalone prose, verbatim from between the `#` heading and the
```playwright``` block — omitted if empty}

### 1.1 {step description from fx.step}

{narration from fx.say, as a prose paragraph}

1. Click **{author description}**.
2. Type **"{typed text}"**.
3. Notice **{author description}**.

> {overlay.text, if present}

### 1.2 {next step…}
...
```

Anchor IDs are `{1-indexed scene number}-{slug(title)}`. The index disambiguates scenes that share a title.

The slug function is deterministic: lowercase the input, replace runs of any non-alphanumeric character with a single `-`, strip leading and trailing `-`. Examples: `"Open the new-project dialog"` → `open-the-new-project-dialog`; `"Welcome back, Alex"` → `welcome-back-alex`. The result of slug applied to an empty or all-symbol title is `untitled` (deterministic fallback).

If a scene has no `fx.step` calls (i.e. only the implicit preamble), the action list renders directly under the H2 with no H3.

### Action sentence templates

Templates are fixed strings in the emitter. No author override in v1.

| Source node | Template | Notes |
|---|---|---|
| `fx.click(selector, description)` | `Click **{description}**.` | |
| `page.click(selector)` (no description) | `Click the target element. *(no description — file:line)*` | Also added to end-of-file warnings list |
| `fx.typeWithDelay(selector, text)` | `Type **"{text}"**.` | The typed value is the only verbatim data we have for fields in v1 |
| `fx.highlight(selector, description)` | `Notice **{description}**.` | |
| `fx.cursorTo(selector, description)` — no click with same selector in the same step | `Look at **{description}**.` | |
| `fx.cursorTo(sel)` + `fx.click(sel)` / `page.click(sel)` with matching selector in same step | folded — emit only the click line, drop the cursor line | Cursor-then-click is one user action; matching by selector is robust to source order |
| `fx.say(text)` | rendered as first prose paragraph of the step (no list number) | |
| `fx.banner(text)` | `**On-screen:** {text}` rendered above the action list, only when the step has no `fx.say` | If both `fx.say` and `fx.banner` exist in a step, banner is dropped (parser already enforces ≤1 each per step) |
| `overlay` callout/highlight block with text | blockquote at end of step: `> {text}` | |
| `fx.pause`, `fx.zoom`, `fx.waitForSelector`, `fx.waitForLoadState`, `fx.waitForURL`, `fx.hideBanner` | omitted | Video-only choreography or wait calls |

### Edge cases

| Case | Behavior |
|---|---|
| Scene has no `playwright` block | Render H2 + standalone prose, nothing else |
| Scene has only the implicit preamble step (no `fx.step` calls) | Actions render directly under H2; no H3 heading |
| `page.click(sel)` (no description argument) | Print fallback `Click the target element.`, append line `file:line` to end-of-file warning list |
| Overlay block with no `text` field | Silently skipped (the visual highlight is video-only) |
| Frontmatter `description` absent | Italic subtitle line omitted entirely |
| Step with neither narration nor actions | Print just the H3 (rare; usually an authoring mistake — making it visible serves the author) |
| Two scenes share a title | Anchor IDs disambiguate via the index prefix; TOC entries also include the index |
| Frontmatter `url` is a long file path | Render as-is in `**URL:**` line; no truncation |

### CLI surface

```
daymo manual <file>                  Write manual.md next to the .demo file
daymo manual <file> --out <path>     Custom output path
daymo manual <file> --stdout         Print to stdout (suppresses file write)
```

Exit codes:
- `0` — wrote (or printed) successfully, regardless of warning count
- `1` — parse failure, file not found, write failure

Warnings (missing descriptions, etc.) are reflected in the manual's end-of-file warning list and printed to stderr. They never fail the command.

### Tests

- **Golden-file snapshots** for every shipped `.demo` in the repo. One Vitest case per file: `expect(emitManual(parse(read(file))).markdown).toEqual(readFixture(file + ".manual.md"))`. Fixtures live in `tests/fixtures/manual/` next to a copy of each source `.demo`.
- **Unit tests** for each template branch:
  - Click with description
  - `page.click` without description (warning emitted)
  - `typeWithDelay`
  - `highlight`
  - `cursorTo` solo
  - `cursorTo` immediately before click (folded, no extra line)
  - Overlay rendered as blockquote
  - Overlay with no text dropped
  - Scene with no playwright block
  - Scene with only implicit preamble (no `fx.step`)
  - Step with `fx.banner` only (rendered as on-screen lead-in)
  - Step with both `fx.say` and `fx.banner` — banner dropped, say wins
  - Two scenes with identical titles — anchors disambiguated
  - Frontmatter without description — subtitle omitted
- **One end-to-end CLI test**: spawn `daymo manual <fixture>`, assert exit 0, assert written file matches golden, assert stderr warning text appears for the warning-bearing fixture.

### Effort estimate

One day of focused work:
- Half-day: emitter implementation, template by template
- Quarter-day: CLI command + wiring
- Quarter-day: golden fixtures + unit + e2e tests

### Risk surface

Low. The emitter is a pure function over data the parser already produces. The CLI command is parallel to existing ones (`set-prose`, `migrate-prose`) and follows the same shape. No browser, no ffmpeg, no Playwright surface touched.

The one real authoring-quality risk is on bare `page.click(selector)` calls with no description — they produce a weak fallback line. The warning list surfaces these so authors can convert them to `fx.click(selector, "…")`. That's a documentation issue, not a code issue.

### Honest tradeoff

The single concrete loss versus the larger phase-2 design: author descriptions are *intent* prose, not the verbatim text rendered on the element. The manual says "Click **the new project button**" rather than "Click **+ New project**". For Ctrl-F over the rendered text of the app's actual buttons, this is a meaningful miss. We are choosing to ship the smaller, no-runtime-cost version first and revisit if users say the author-description fidelity isn't good enough.

## Phase 2 (deferred — design sketch only)

When/if shipped: a `--with-labels` flag on `daymo capture` that, during the existing capture run, evaluates the target element after each `fx.click` / `fx.highlight` / `fx.cursorTo` / `fx.typeWithDelay` and writes `resolvedLabel: string` onto the `fx` event in `events.json`. Resolution priority for buttons: `innerText` (1–60 chars, has letters) → `aria-label` → `title` → `<img alt>` → `value` → author description. For typed fields: associated `<label>` → `aria-label` → `placeholder` → `name` → author description.

The manual emitter gets a second mode: when `events.json` exists alongside the `.demo`, prefer the resolved label; otherwise fall back to author description. The output filename stays `manual.md` either way — a re-run with labels just overwrites.

No new fx methods. No source tagging in events. Resolution is purely a value upgrade.

## Phase 3 (deferred — design sketch only)

When/if shipped: the emitter pulls stills from `raw_page.webm` via `ffmpeg -ss <event.t / 1000> -i raw_page.webm -frames:v 1 <out>` at the timestamps for each action event. Stills are written to `manual-assets/scene-{n}-step-{m}-action-{k}.png` and embedded after the action sentence. Overlays/cursor are baked into the frame, which matches what the video reader sees — a feature, not a bug.

No new capture pipeline. No annotation pass. The fuzziness concern that originally motivated a dedicated screenshot pipeline does not apply here: a manual still doesn't need millisecond accuracy.
