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
`fx.highlight` / `fx.zoom` resolve their selector and **throw if it is
null/absent**, instead of drawing. That turns every cursor/highlight/zoom into a
selector liveness assertion, on top of the real clicks/types/waits. Note the two
resolution paths in the current code (post-fix):

- `cursorTo` resolves via `page.locator(sel).first().boundingBox()` and already
  throws on null.
- `highlight` resolves via `page.locator(sel).first().elementHandle()` and
  already throws on null.
- `zoom` resolves via `elementHandle()` **but a null selector means full-page
  zoom, so it does NOT throw today**. In check mode, when `zoom` was given a
  selector and `elementHandle()` returns null, it must throw
  `selector not found: <sel>` — otherwise a broken `zoom` selector silently
  degrades to a full-page zoom and the check passes when it shouldn't.

## Components

### `src/core/check.ts` — `checkDemo(ast, opts)`
Mirrors `core/capture.ts`. Resolves `storageState`/`mocks` paths relative to the
demo dir (same as capture, `core/capture.ts:48-50`), applies the `--base-url`
**origin** override to `ast.frontmatter.url` (net-new code — nothing does this
today): keep the frontmatter path/query, swap protocol+host, i.e.
`const u = new URL(frontmatter.url); const o = new URL(baseUrl); u.protocol = o.protocol; u.host = o.host;`
and use `u.toString()`. When `--base-url` is absent, use `frontmatter.url`
unchanged. Then starts a `Controller` in `mode: "check"`, runs every scene, and
returns:

`demoId` is derived exactly as `index`/`stitch` do —
`path.basename(demoFile, path.extname(demoFile))` (e.g.
`demos/03-create-document/03-create-document.demo` → `03-create-document`, the
`NN-` prefix is **kept**). `CheckStep.label` is sourced from the recorded `step`
event's `description` field (the event has no `label` field; `checkDemo` maps
`description → label`).

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
Discovers `.demo` files (recursive) by reusing the existing discovery helper.
That helper is currently a **private, non-exported** `findDemoFiles` in
`src/indexer/write-index.ts` (it skips dot-dirs + `node_modules`, sorts results,
and throws `no .demo files found in <dir>` on zero — which satisfies our
"exit 1 on zero demos" requirement). Export it from `write-index.ts` (or move it
to `src/core/discover.ts` and have write-index import it), then reuse — do not
reimplement. Runs `checkDemo`
for each **sequentially** (a shared seeded app is stateful; parallel runs would
race — e.g. the create-course demo mutating data another demo reads). Catching
per demo means one break does not mask later demos. Prints the report; exits `1`
if any `!ok`, else `0`.

Default `path` is `./demos`.

### `Controller` / `createFx` changes
- `ControllerOpts` gains `mode?: "capture" | "check"` (default `"capture"`) and
  `timeout?: number`.
- `ControllerOpts.artifactsDir` becomes optional. In check mode there are no
  artifacts: skip `fs.mkdir(artifactsDir)` in `start()`, omit `recordVideo` from
  `browser.newContext({...})`, and in `stop()` skip the `readdir`/webm-rename and
  the `events.json` write entirely (just close context + browser).
- `Controller.start`: when `mode === "check"`, after creating the page call
  `page.setDefaultTimeout(timeout)` and `page.setDefaultNavigationTimeout(timeout)`
  **before** `page.goto` (default 15000) — so an unreachable app fails the
  initial goto in seconds rather than hanging 30s. Skip the TTS pre-synthesis
  block in `runScene` (already gated on `ttsProvider`, which check mode does not
  pass) and skip the `scene.overlays` directive loop.
- `Controller` must still construct `createFx` **with a real `stepCtx`** in check
  mode (same as capture, `controller.ts:111-113`) — otherwise `fx.step` no-ops
  (`fx.ts` early-returns when `stepCtx` is undefined) and failure labels are
  empty. The current step label is read back from the recorded `step` events.
- `createFx` gains the mode (passed through from the controller). In check mode:
  - `say` → **returns immediately, before the `sayCtx` guard** (today `say`
    throws "not available outside of capture" when `sayCtx` is absent; check mode
    must short-circuit ahead of that). Records nothing.
  - `pause` → `Math.min(requestedMs, 100)`.
  - `cursorTo` → resolve via `page.locator(sel).first().boundingBox()`, throw
    `selector not found: <sel>` if null; no `window.__daymo.*` call. (Already
    throws on null today; just skip the overlay draw.)
  - `highlight` → resolve via `page.locator(sel).first().elementHandle()`, throw
    `selector not found: <sel>` if null; no draw. (Already throws today.)
  - `zoom` → resolve via `elementHandle()`; **if a selector was provided and the
    handle is null, throw `selector not found: <sel>`** (new — today a null
    handle silently means full-page zoom); no draw.
  - `typeWithDelay` → real typing with delay `0`.
  - `click` / other real actions / `waitFor*` → unchanged.
  - `step` → unchanged (still records the step marker; used for failure labels).

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

✓ 01-create-course      4 steps  1.9s
✓ 02-share-course       3 steps  1.4s
✗ 03-create-document    step 2 "Title it"
    selector not found: #title (15000ms)
    demos/03-create-document/03-create-document.demo:22
✓ 04-document-basics    3 steps  2.1s

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

- **fx check-mode unit** (`tests/unit/fx.test.ts` or a sibling; reuse the
  existing fake-page at `tests/unit/fx.test.ts:6-28` whose
  `locator().first().boundingBox()/elementHandle()` resolve null together when
  `measureResult` is null): with a resolving locator, `cursorTo`/`highlight`/
  `zoom` succeed and draw nothing (no `window.__daymo.*` evaluate); with a
  locator whose `boundingBox()`/`elementHandle()` resolve null, each of the three
  throws `selector not found: <sel>` via its own resolution path (cursorTo via
  boundingBox, highlight + zoom via elementHandle). `pause` caps to 100ms; `say`
  returns without throwing even with no `sayCtx`.
- **check integration** (`tests/integration/check.test.ts`): reuse
  `startFixtureServer()` from `tests/integration/server.ts` (serves
  `tests/fixtures/sample-app/index.html`, the same harness
  `controller.test.ts` uses). One demo driving the fixture's mid-flow elements
  (e.g. the hidden `[data-testid=new-project-dialog]` revealed after clicking
  `[data-testid=new-project-btn]`) with valid selectors → `checkDemo` returns
  `ok: true` with the right step count; one demo whose `fx.highlight` targets a
  missing selector → `ok: false` with `failure.step.label` (from the step
  `description`) and `failure.selector` set. Assert the aggregate drives the
  right exit code.
- **discovery**: a fixture dir with nested `.demo` files → all discovered via the
  reused `findDemoFiles`.

## Rollout

1. Land `daymo check` in Daymo (this spec), with tests.
2. typenote: add `npx daymo check demos/ --base-url "$APP_URL"` to the existing
   e2e job, after the seeded app is up. Demote/remove the full render→publish CI
   workflow (rendering becomes a manual `pnpm help:build:real` step authored and
   reviewed by a human, committed with the code change). These are separate
   follow-ups, not part of this Daymo plan.
