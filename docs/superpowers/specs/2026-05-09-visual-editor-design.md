# Daymo Visual Editor — design

**Status:** draft for implementation
**Date:** 2026-05-09
**Branch:** `visual-editor` (from `main`, i.e. v0.1)

## Goal

Add a localhost visual editor for `.demo` files that lets the author iterate on a demo scene-by-scene with AI-scoped edits. The editor shows the planned timeline whether captured or not, plays per-scene previews, and hands batched review-style asks to the user's separately-running Claude Code session via the clipboard.

## Non-goals

- No LLM client inside the editor. AI work is owned by the user's existing Claude Code session.
- No backport of v0.2 features (slates, transitions, fast-forward, intro/outro, music compose into the per-scene pipeline). Those layer on later. Music is preserved only at final stitch via the existing `frontmatter.music` mechanism.
- No multi-user / collaboration. Single user, single localhost server.

## User flow

1. `daymo edit demo.demo` boots a localhost server, opens the browser, watches the file.
2. Editor shows the parsed scene list in a left rail (uncaptured by default).
3. User clicks "Capture all" or per-scene "Capture" to produce per-scene `.webm` previews.
4. User clicks a scene; right pane shows the per-scene preview, the editable caption, the overlays, and an "+ comment" affordance under each block.
5. User adds N draft comments across scenes (PR-style). Counter shows "N drafts."
6. User clicks **Submit review**. Editor formats one batched prompt with full scope context, copies to clipboard, clears drafts. Toast: "Copied — paste into Claude Code."
7. User pastes into Claude Code. Claude Code edits the `.demo`. Editor file-watches and refreshes.
8. User re-captures affected scenes, reviews, marks each scene **Approved**.
9. When every scene is approved, **Stitch** unlocks. Click → ffmpeg concat → `output.mp4` (with music if present in frontmatter).

A separate inline path exists for tiny edits: clicking a caption block enters edit mode; typing + blur (or Cmd+Enter) writes the change back to the `.demo` directly, no AI involved.

## Architecture

### Process model

`daymo edit` is a new CLI subcommand. It is the only long-running process. It:

- Parses the `.demo` and exposes the AST over an API
- Serves a static React bundle (built once at npm publish time) at `/`
- Exposes JSON endpoints for state + actions (capture, approve, stitch, edit-caption)
- Streams progress events (capture lines, ffmpeg lines, file-watch refreshes) over Server-Sent Events at `/api/events`
- Spawns Playwright (via the existing `Controller`, refactored — see below) to capture a single scene
- Spawns ffmpeg (via `execa`) to stitch
- File-watches `demo.demo` (so external Claude Code edits show up) and `.daymo/captures/` (so capture progress reflects in the UI)

### Pattern A: editor as scope-aware composer, not LLM client

The editor never calls an LLM. The "AI integration" is the user. Submit just **formats and clipboards**. Daymo grows no LLM dependency.

### Sidecar layout

Project-relative, beside the `.demo`:

```
demo.demo
.daymo/
  state.json                   ← per-scene approval flags + capture timestamps
  captures/
    scene-001.webm             ← per-scene capture (one Playwright run each)
    scene-001.events.json      ← events for that scene only
    scene-002.webm
    ...
output.mp4                     ← only after stitch
```

`.daymo/` is the editor's only persistent state. Drafts (pending comments) are NOT persisted — they live in the React app's in-memory state for the session. Closing the browser tab discards drafts.

### Per-scene capture (new in v0.1)

`runner.ts` today calls `Controller.start` once and then loops `runScene` for every scene into one webm. The editor needs a single-scene capture. We refactor:

- `controller.ts` exposes a new `captureSingleScene(scene, opts) → { webm, events }` helper that creates its own `Controller`, runs one scene, stops, and returns the artifact.
- The existing `render` function continues to work via the same Controller in loop mode for back-compat.

Each per-scene capture:

1. Spawns a fresh chromium context (storageState if configured)
2. Navigates to `frontmatter.url`
3. Attaches mocks
4. Runs the scene's playwright code + overlays (same `runScene` logic)
5. Stops, renames the resulting `.webm` to `scene-<NNN>.webm` in `.daymo/captures/`
6. Writes `scene-<NNN>.events.json` for that scene's events

This is essentially v0.2's per-scene capture mode with a thinner shape (no manifest, no bundle, no scene-config block — a pure helper).

### Final stitch

ffmpeg concat demuxer:

```
ffmpeg -f concat -safe 0 -i concat-list.txt -c:v libx264 [music args] output.mp4
```

`concat-list.txt` is generated each stitch from the approved-scene order. Music muxed via the same filter as `compositor.ts` does today.

The current `compositor.ts` keeps working for `daymo render` users. A new `stitch.ts` module owns the concat path. Both share the music-mux helper.

### File watching and edit loops

`demo.demo` is watched. When it changes:

- Re-parse
- Diff scenes by `sourceLine` (existing identity in v0.1)
- Mark any scene whose content changed as `pending` (capture invalidated; user must re-capture)
- Push state over SSE; UI refreshes

The editor itself writes to `.demo` for inline caption edits. To avoid loops, the server suppresses its own writes from the watcher (write a sentinel, settle for ~50ms, ignore the next event).

## UI

### Layout

Two-pane split:

- **Left rail (≈30% width):** scene list. One row per scene. Row content: index, title, duration, state badges (`🎬 captured`, `💬 N drafts`, `✓ approved`, `⊘ pending`).
- **Right pane:** detail for the selected scene. Three vertical zones:
  - Top: video preview + scene-level actions (Re-capture, Approve)
  - Middle: tabs — `Script` always; `Overlays` only if any; `Errors` only if any. **No Playwright tab.**
  - Active tab content scrolls. Each block under a tab is a "commentable" unit — has a `+ comment` affordance.

### States and badges

Per-scene state machine:

```
pending  ─(capture)─►  captured  ─(approve)─►  approved
   ▲                       │
   └──── (.demo edited) ◄──┘   (any edit invalidates approval)
```

Drafts are orthogonal — they don't change scene state, just show a count.

`approved` = "this scene is good for final stitch." `Stitch` button is disabled unless every scene is `approved`.

### PR-style draft comments

- Below every commentable block (caption, overlay), a `+ comment` link reveals a small inline composer.
- Submitting a draft adds an inline draft card under that block (orange-bordered).
- Drafts persist across scene navigation in the same browser session, in memory.
- Top-right shows a global counter and a single **Submit review** button.

**Submit review** action:
1. Builds a single Markdown prompt from all drafts (see prompt template below)
2. Writes to `navigator.clipboard.writeText(...)`
3. Clears drafts
4. Shows a success toast

### Submit review prompt template

```markdown
You're editing `<demo.demo path>`. The user has left these review comments —
please apply them as a single edit. Do NOT touch scenes that are not mentioned.
After editing, do not run capture; the editor will handle that.

## Comment 1 — Scene 1 (caption)

Current text:
> Welcome back, Alex. This is your project dashboard — the home base for everything you build.

User comment:
> shorten this — two sentences max

## Comment 2 — Scene 1 (overlay)

Current overlay:
```yaml
type: callout
target: "[data-testid='new-project-btn']"
text: "Click here to start a new project"
```

User comment:
> callout text reads weird, rewrite as a friendlier nudge

## Comment 3 — Scene 3 (caption)

...
```

### Inline caption editing

`Script` tab caption blocks are `contenteditable`. On blur or Cmd+Enter, the editor `PUT`s the new text. The server writes back to `.demo` (preserving the rest of the file untouched — replace the prose region between heading and next fence/scene break).

Inline edits don't auto-invalidate approval. They DO invalidate capture: the cap shows a stale-warning chip ("captured before this edit — re-capture?").

### Visual style

- Vite + React + TypeScript
- Tailwind CSS, shadcn/ui components for cards / tabs / buttons / dialogs
- Dark theme to match a video-editor mood
- Monospace for code/overlay blocks; system font for prose

## API

All endpoints under `/api/`. Server is unauthenticated localhost-only (binds `127.0.0.1`).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/state` | — | full state: parsed demo, scene states, capture metadata |
| POST | `/api/capture/:sceneIndex` | — | `{ ok }` (progress streams via SSE) |
| POST | `/api/capture-all` | — | `{ ok }` |
| POST | `/api/script/:sceneIndex` | `{ prose: string }` | `{ ok }` (writes .demo) |
| POST | `/api/approve/:sceneIndex` | `{ approved: boolean }` | `{ ok }` |
| POST | `/api/stitch` | — | `{ output: string }` (or 409 if not all approved) |
| GET | `/api/events` | (SSE) | event stream of state changes |

### SSE event shapes

```ts
type Event =
  | { type: "state"; state: State }                 // full state replace
  | { type: "capture-progress"; sceneIndex: number; line: string }
  | { type: "capture-done"; sceneIndex: number; webmPath: string }
  | { type: "capture-error"; sceneIndex: number; message: string }
  | { type: "stitch-progress"; line: string }
  | { type: "stitch-done"; output: string }
  | { type: "demo-changed" }                        // .demo file watcher fired
```

## File layout

```
src/
  cli.ts                       (existing — add `edit` subcommand)
  controller.ts                (refactor — add captureSingleScene)
  runner.ts                    (existing render still works)
  compositor.ts                (existing — keep for daymo render)
  parser.ts                    (existing)
  overlay.ts                   (existing)
  fx.ts, mocks.ts, sandbox.ts  (existing)
  editor/
    server.ts                  (Node http server, route table, SSE bus)
    state.ts                   (in-memory state + .daymo/state.json persistence)
    capture.ts                 (wraps captureSingleScene, queues, emits SSE)
    stitch.ts                  (ffmpeg concat + music)
    script.ts                  (parse-aware caption rewrite into .demo)
    watcher.ts                 (chokidar over .demo + .daymo/, debounced)
    api.ts                     (handlers for /api/*)
  editor-ui/                   (Vite project, builds into dist/editor-ui)
    package.json, vite.config.ts, tsconfig.json
    index.html
    src/
      main.tsx
      App.tsx
      hooks/                   (useState SSE, useDemoState)
      components/
        Rail.tsx
        Preview.tsx
        Tabs.tsx, Script.tsx, Overlays.tsx, Errors.tsx
        Composer.tsx           (+ comment + draft card)
        ReviewBar.tsx          (top-right "N drafts · Submit review")
        StitchBar.tsx          (gated stitch button)
      lib/
        api.ts, sse.ts, prompt.ts (formats the batched markdown)
dist/
  editor-ui/                   (build output, shipped in npm tarball)
tests/
  editor/
    capture.test.ts            (vitest — per-scene capture writes correct files)
    stitch.test.ts             (vitest — concat list + ffmpeg args)
    script.test.ts             (vitest — caption rewrite preserves .demo)
    prompt.test.ts             (vitest — submit-review markdown shape)
```

## Testing strategy

- **Unit:** parser-preserving caption rewrite, prompt formatter, ffmpeg args builder, state reducer.
- **Integration:** `captureSingleScene` against the existing `tests/fixtures/sample-app` — assert webm + events produced.
- **E2E (smoke):** start the editor server in test mode, hit `/api/state`, capture scene 1 of the fixture, assert state transitions. UI is not E2E-tested in MVP (Playwright-against-self is heavy and the value is low for a localhost tool).

## Risks and open questions

- **Inline caption editing's write-back is parser-coupled.** The `.demo` is markdown with YAML frontmatter; replacing prose without breaking surrounding fences requires re-using the parser's source ranges. Fallback: read full .demo, regex-replace the prose region using the scene's `sourceLine`. Validate by re-parsing afterward and erroring (and reverting) if the new AST diverges in scene count.
- **File-watch loops.** Suppression sentinel needs to be reliable across editors that write atomically (rename-replace). Settle window may need tuning.
- **Capture queue.** If user clicks "Capture all" we run scenes sequentially (one Chromium at a time) to keep memory predictable. Make this explicit in `capture.ts` — a single-slot queue.
- **Approval loss on edit.** Currently any `.demo` edit on a scene drops it back to `pending`. This is correct but loud. We may later want a less-aggressive heuristic (e.g., caption-only edits don't drop approval). Out of MVP.
- **Real one-click handoff.** Clipboard requires a paste. If we later want true one-click into a running Claude Code session, options are: tmux `send-keys`, an MCP server hook, a Claude Code slash command convention. Punted.
- **Music in stitch.** Each per-scene capture is silent. Music is muxed once at stitch time using `frontmatter.music`. Same volume default (0.4) as `compositor.ts`.

## Out of scope (future work)

- Slates (intro/outro), transitions between scenes, fast-forward primitive, dip-to-black — pull in from v0.2 design later, surfaced as editor controls.
- Sub-scene comment targets (timestamps in the video, specific overlays) — current "+ comment under a block" is enough for MVP.
- Multi-user / collaborative editing.
- File-based handoff + slash command. tmux/MCP integration.
- Storybook of the React components.
- Persistent draft saves across browser refresh.
