# `daymo check` — CI canary for demo scripts

**Status:** Approved (2026-06-07)

## Problem

Daymo demo videos are *content*, not code: a human authors them, watches the
result, and commits the rendered bundle. They change rarely (only when the UI
they show changes, or a demo is added/rewritten), and they need human review —
so re-rendering them on every CI run is the wrong model (slow, expensive, and it
either auto-publishes an unreviewed take or blocks the pipeline on a video
nobody watched).

But there is a real CI signal worth having: **when does a demo script stop
matching the app?** A button gets renamed, a modal field's id changes, a flow
adds a step — and the committed video silently goes stale. We want CI to fail
the moment a how-to script no longer drives the app, *without recording
anything*. The video is irrelevant to this check; only "do the steps still
execute against the real UI" matters.

A second requirement: this must be **easy for any project consuming Daymo to
adopt** — ideally one line in the CI job they already have.

## Goal

A `daymo check` CLI command that runs every `.demo` through the real capture
machinery with recording/TTS/overlays/pauses stripped, asserts every selector
the demo touches still resolves, fails fast with a human-readable location, and
writes nothing. Consuming projects drop one line into their existing e2e job.

## Non-goals

- Not a renderer or visual-diff tool (explicitly: "video isn't relevant").
- Not a static linter — it must catch breakage that only appears mid-flow
  (modals, post-navigation pages), which is most of what these demos exercise.
  That requires actually running the flow.
- Daymo does not own *booting* the app under test. Every project boots/seeds
  differently (Supabase, env, fixtures). Daymo owns everything *after the page
  loads*; the project supplies a running, seeded app — which its e2e job already
  does.

## Why full-flow against the running app

The check reuses the running, seeded app the project's e2e suite already stands
up in CI, so it needs **no new infrastructure**. Running the real flow (not a
static selector scan) is what makes the signal honest: a demo's later selectors
(`#course-name` in a modal, `.ProseMirror` after navigation) only exist after
earlier steps execute. A static scan against the start page can't see them and
would miss the majority of real breakage.

## Architecture

The check reuses the **exact same `Controller`** that capture uses, so the check
can never drift from what a real capture would do. The only difference is a new
execution mode that disables the layers that exist purely to produce a
reviewable video.

```
daymo check [path]
  └─ discover .demo files (recursive; same discovery index uses)
       └─ for each demo: checkDemo(ast, {baseUrl, timeout})
            └─ Controller.start({ mode: "check", ... })   # no recordVideo, no TTS
                 └─ runScene() per scene, fx in check mode
            └─ collect {demoId, steps, ok, failure?}
  └─ print report, exit 1 if any demo failed
```

### Capture vs. check (what each layer does)

| Layer | Capture | Check |
|---|---|---|
| clicks / typing / waits (`fx.click`, `fx.typeWithDelay`, `page.*`) | real | **real** (typing delay forced to 0) |
| selector resolution (`fx.cursorTo` / `fx.highlight` / `fx.zoom`) | resolve + draw overlay | **resolve + assert exists**, no draw |
| `recordVideo` | on | **off** (omitted from `newContext`) |
| TTS synthesis (`fx.say`) | on | **no-op** (skip pre-synth + skip at call) |
| real-time pauses (`fx.pause`) | honored | **capped to ~100ms** |
| overlay directives (the post-code `scene.overlays` block) | drawn | **skipped** |
| `auth.storageState` + `mocks` | honored | **honored** (logged-in demos + AI mock still work) |

The core assertion of the whole feature: in check mode `fx.cursorTo` /
`fx.highlight` / `fx.zoom` resolve their selector via
`page.locator(sel).first().boundingBox()` and **throw if it is null/absent**,
instead of drawing. That turns every cursor/highlight/zoom into a selector
liveness assertion, on top of the real clicks/types/waits.

## Components

### `src/core/check.ts` — `checkDemo(ast, opts)`
Mirrors `core/capture.ts`. Resolves `storageState`/`mocks` paths relative to the
demo dir (same as capture), applies `--base-url` origin override to
`ast.frontmatter.url`, starts a `Controller` in `mode: "check"`, runs every
scene, and returns:

```ts
interface CheckStep { sceneIndex: number; stepIndex: number; label: string }
interface CheckFailure {
  step?: CheckStep;        // last fx.step entered before the throw, if any
  selector?: string;       // selector that failed to resolve, if extractable
  message: string;         // error message
  file: string;            // .demo path
  line?: number;           // source line of the failing scene block
}
interface CheckResult {
  demoId: string;          // folder name minus NN- prefix, matching index/build
  ok: boolean;
  durationMs: number;
  steps: CheckStep[];      // steps that executed
  failure?: CheckFailure;  // present iff !ok
}
```

A thrown error is caught here, mapped to `CheckFailure` (carrying the current
`fx.step` label as the human-readable location), and returned as
`{ok: false, failure}` — `checkDemo` itself does not throw on demo failure
(only on programmer error like a missing file).

### `src/commands/check.ts` — `checkCommand(path, flags)`
Discovers `.demo` files (recursive; reuse the discovery helper `index` uses —
extract it if it is currently inline in `commands/index.ts`). Runs `checkDemo`
for each **sequentially** (a shared seeded app is stateful; parallel runs would
race — e.g. the create-course demo mutating data another demo reads). Catching
per demo means one break does not mask later demos. Prints the report; exits `1`
if any `!ok`, else `0`.

Default `path` is `./demos`.

### `Controller` / `createFx` changes
- `ControllerOpts` gains `mode?: "capture" | "check"` (default `"capture"`).
- `Controller.start`: when `mode === "check"`, omit `recordVideo` from
  `context = browser.newContext({...})`; skip the TTS pre-synthesis block in
  `runScene`; skip the `scene.overlays` directive loop; do not write
  `events.json`/rename webm in `stop()` (nothing to write).
- `createFx` gains the mode (passed through from the controller). In check mode:
  - `say` → resolves immediately, records nothing.
  - `pause` → `Math.min(requestedMs, 100)`.
  - `cursorTo` / `highlight` / `zoom` → `await page.locator(sel).first().boundingBox()`;
    throw `Error("selector not found: " + sel)` if null; no `window.__daymo.*` call.
  - `typeWithDelay` → real typing with delay `0`.
  - `click` / other real actions → unchanged.
  - `step` → unchanged (still records the step marker; used for failure labels).
- Per-action timeout: `checkDemo` sets Playwright's default timeout on the
  context/page from `opts.timeout` (default 15000) so a broken selector fails in
  seconds, not the Playwright 30s default.

### `cli.ts`
Register:
```
daymo check [path]
  --base-url <url>   Override the origin of each demo's frontmatter url
  --timeout <ms>     Per-action timeout (default 15000)
  --json             Emit the report as JSON instead of the text table
```

### README
A copy-paste CI snippet (the "easy button"):
```yaml
# In the e2e job, after the app is up and seeded:
- run: npx daymo check demos/ --base-url "$APP_URL"
```

## CLI output

Text (default):
```
daymo check demos/

✓ create-course      4 steps  1.9s
✓ share-course       3 steps  1.4s
✗ create-document    step 2 "Title it"
    selector not found: #title (15000ms)
    demos/03-create-document/03-create-document.demo:22
✓ document-basics    3 steps  2.1s

1 of 4 demos broken → exit 1
```

`--json`: `{ ok: boolean, demos: CheckResult[] }` to stdout.

## Error handling

- **Demo step throws** (broken selector, timeout, navigation failure): caught in
  `checkDemo`, recorded as `failure`, loop continues. Exit 1 at the end.
- **App not reachable** (`page.goto` fails): surfaces as that demo's failure with
  the goto error; still continues to the next (they will likely all fail, making
  the misconfiguration obvious in the report).
- **Missing `.demo` / unreadable path / bad frontmatter**: programmer/config
  error — throw from `checkCommand`, exit 1 with `daymo: <message>` (existing CLI
  error path in `cli.ts`).
- **No `.demo` files found** under `path`: exit 1 with a clear message (silent
  success on zero demos would hide a misconfigured path).

## Testing

- **fx check-mode unit** (`tests/unit/fx.test.ts` or a sibling): with a fake page
  whose locator resolves, `cursorTo`/`highlight`/`zoom` succeed and draw nothing
  (no `window.__daymo.*`); with a locator that returns `boundingBox() → null`,
  they throw `selector not found: <sel>`. `pause` caps to 100ms; `say` is a
  no-op.
- **check integration** (`tests/integration/check.test.ts`): serve a tiny static
  page locally (reuse the existing test http-server pattern). One demo with valid
  selectors → `checkDemo` returns `ok: true` with the right step count; one demo
  whose `fx.highlight` targets a missing selector → `ok: false` with
  `failure.step.label` and `failure.selector` set. Assert `checkCommand` exit
  code via the returned aggregate.
- **discovery**: a fixture dir with nested `.demo` files → all discovered.

## Rollout

1. Land `daymo check` in Daymo (this spec), with tests.
2. typenote: add `npx daymo check demos/ --base-url "$APP_URL"` to the existing
   e2e job, after the seeded app is up. Demote/remove the full render→publish CI
   workflow (rendering becomes a manual `pnpm help:build:real` step authored and
   reviewed by a human, committed with the code change). These are separate
   follow-ups, not part of this Daymo plan.
