# CLI parity & TTS narration

**Status:** Design
**Date:** 2026-05-10

## Goal

Two related upgrades to Daymo, motivated by the user's workflow of driving the tool from Claude Code:

1. **CLI parity with the editor.** Every action the editor's HTTP API performs (per-scene capture, stitch, prose rewrite) must also be a CLI subcommand. The CLI is the surface humans copy-paste into Claude Code; the editor's web UI is one consumer of the same actions, not a superset.
2. **TTS narration with karaoke subtitles.** Make demos look like real "how-to" videos: voice-over driven explicitly from the script, with a bottom subtitle bar that highlights the currently-spoken word.

## Constraints / decisions

- **Explicit timing.** All ordering of narration and actions is decided in the playwright block. No implicit defaults like "narration auto-plays at scene start" or "narration runs in parallel by default". The user paces everything.
- **Free, today.** TTS uses Edge TTS (Microsoft's unofficial WebSocket TTS, free, no API key, emits word boundaries). Provider abstraction allows paid providers (ElevenLabs, OpenAI, Azure) to slot in later — out of scope for v1.
- **CLI is agent-friendly.** Commands print final artifact paths to stdout, errors to stderr, non-zero exit on failure. Top-level command names; positional `<file>` arg; `--scene N` is 1-indexed.
- **Approval is removed.** The `pending → captured → approved` state machine collapses to `pending → captured`. Stitch composes whatever is captured; reviewer trust is implicit.

## CLI surface

```
daymo render <file>                              (existing — full pipeline)
daymo doctor                                     (existing)
daymo edit <file> [--port N] [--no-open]         (existing — web editor)

daymo capture <file> --scene N                   (NEW — capture one scene)
daymo capture <file> --all                       (NEW — capture all scenes)
daymo stitch <file>                              (NEW — compose captured into output.mp4)
daymo state <file> [--json]                      (NEW — print scenes table or raw JSON)
daymo set-prose <file> --scene N --text "..."    (NEW — rewrite scene prose markdown)
daymo migrate-prose <file>                       (NEW — one-shot: wrap each scene's prose in fx.say)
```

Conventions:
- `<file>` is positional first arg, the `.demo` path
- `--scene N` is **1-indexed** (matches `scene-001.webm` filename pattern; humans count from 1)
- All commands operate on `<demo-dir>/.daymo/` — same state directory the editor uses, so CLI and editor share state live
- Success: print final artifact path(s) to stdout, exit 0. Failure: error on stderr, non-zero exit
- `daymo state` without `--json` prints a compact human table; `--json` is for agent consumption

## Architecture

```
src/
├── cli.ts                    thin command-dispatcher
├── commands/
│   ├── render.ts             (existing)
│   ├── doctor.ts             (existing)
│   ├── edit.ts               (existing)
│   ├── capture.ts            (NEW)
│   ├── stitch.ts             (NEW)
│   ├── state.ts              (NEW)
│   ├── set-prose.ts          (NEW)
│   └── migrate-prose.ts      (NEW)
├── core/                     (NEW directory — shared by CLI & editor)
│   ├── store.ts              load/save .daymo/state.json
│   ├── capture.ts            single-scene capture (moved from src/single-capture.ts)
│   ├── stitch.ts             stitch from state (moved from src/editor/stitch.ts)
│   └── rewrite.ts            prose markdown rewrite (moved from src/editor/script-rewrite.ts)
├── tts/                      (NEW)
│   ├── provider.ts           TtsProvider interface
│   ├── edge.ts               Edge TTS implementation
│   └── cache.ts              content-addressed cache wrapper
├── overlay.ts                + karaoke subtitle bar + banner show/hide
├── fx.ts                     + fx.say, fx.banner, fx.hideBanner
├── controller.ts             + pre-synthesis pass; injects sayTable
└── editor/
    ├── server.ts             HTTP handlers become thin wrappers over core/
    └── ...
```

Editor's HTTP handlers and CLI commands both call into `core/*`. There is one place that knows how to capture, one place that knows how to stitch, one place that knows how to rewrite prose. Editor and CLI cannot diverge.

## File layout

```
<demo-dir>/
├── <demo>.demo
├── output.mp4                    stitch result
└── .daymo/
    ├── state.json                scene rows: capturedAt, paths
    ├── captures/
    │   ├── scene-001.webm
    │   ├── scene-001.events.json    incl. fx.say events with offsets
    │   ├── scene-002.webm
    │   └── ...
    └── tts/                          (NEW)
        ├── <hash>.mp3               content-addressed by (text, voice, rate, provider)
        ├── <hash>.timings.json      word boundaries
        └── <hash>.meta.json         input + provider, for debugging
```

## `.demo` format additions

### Frontmatter

```yaml
tts:
  provider: edge                     # default: edge
  voice: en-US-AriaNeural            # default. provider-specific id
  rate: "+0%"                        # SSML rate
  music_duck: true                   # auto-lower bg music when fx.say is playing
```

All optional. If `tts:` is absent, defaults apply. If no `fx.say` calls exist anywhere in the demo, no TTS is fetched, no audio track is added — behaves exactly like today.

### `fx` runtime additions

```ts
fx.say(text: string, opts?: { voice?: string; rate?: string }): Promise<void>
fx.banner(text: string, opts?: { duration?: number; title?: string }): Promise<void>
fx.hideBanner(): Promise<void>
```

**`fx.say(text)`** narrates `text` with the current voice. Returns a promise that resolves when audio finishes. Awaited = sequential, not awaited (stored in a Promise variable) = parallel:

```js
// Sequential: voice finishes, then click
await fx.say("Click the new project button to begin.");
await page.click("[data-testid='new-project-btn']");

// Parallel: voice plays while cursor moves
const n = fx.say("Welcome back, Alex. This is your dashboard.");
await fx.cursorTo("h1");
await fx.pause(0.5);
await n;
```

**Constraint (v1):** the `text` arg of `fx.say` must be a string literal. Pre-synthesis scans the playwright source for `fx.say("...")` literals; non-literal args (template strings with interpolation, dynamic concatenation) throw at pre-synthesis with `fx.say requires a string literal: <file:line> "<excerpt>"`. Future work: runtime synthesis fallback.

**`fx.banner(text, { duration?, title? })`** shows a fixed banner at the bottom of the viewport using the existing caption-banner styling. If `duration` is provided, banner auto-hides; otherwise call `fx.hideBanner()` explicitly. Replaces the auto-prose-as-banner behavior.

### Subtitle visual

A single bottom-anchored bar, ~80% viewport width, dark translucent background, white text. The whole sentence is visible while playing; the currently-spoken word is highlighted (bold + accent color), driven by the word-timing array. When `fx.say` resolves, the bar fades out (200ms). Two `fx.say` calls back-to-back: bar stays visible, content cross-fades.

If `fx.banner` and `fx.say` are active at the same time, the banner sits above the subtitle bar (separate vertical slots).

### Prose

Prose under each `# Scene heading` becomes purely descriptive markdown — not auto-rendered, not auto-narrated. To narrate prose, use `fx.say(...)`. To show as a banner, use `fx.banner(...)`. The `daymo migrate-prose` command performs the mechanical migration of existing demos.

## TTS subsystem

### `TtsProvider` interface

```ts
interface TtsProvider {
  synthesize(opts: { text: string; voice: string; rate: string }): Promise<{
    audio: Buffer;                                    // mp3 bytes
    timings: { word: string; startMs: number; endMs: number }[];
  }>;
}
```

### Edge TTS implementation

Uses an existing npm library (final pick — `msedge-tts` likely candidate — chosen during writing-plans). Word boundaries from the protocol's `WordBoundary` events. No alignment required.

### Caching (`tts/cache.ts`)

Content-addressed by SHA-256 of `JSON.stringify({ text, voice, rate, provider })`. Wraps any `TtsProvider`:

- **Hit:** read mp3 + timings from disk, return without network call.
- **Miss:** call provider, write `<hash>.mp3` + `<hash>.timings.json` + `<hash>.meta.json` to `.daymo/tts/`, return.
- **Partial corruption:** mp3 exists but timings missing/corrupt → treat as miss, re-synthesize, overwrite.

## Capture-time flow

1. **Pre-synthesis pass.** Before `Controller.runScene`, scan the playwright source for `fx.say("...")` literals. Synthesize each via the cached provider. Cache hits are free; misses fan out in parallel. Aborts capture if any non-literal `fx.say` arg is encountered.
2. **Inject sayTable into the page.** `controller.ts` adds an init script with `window.__daymo.sayTable = { "<hash>": { durationMs, words: [...] } }`. Audio bytes stay in Node — the page only needs timings to drive the subtitle.
3. **`fx.say(text)` runtime.** `fx.ts` computes the hash, calls `page.evaluate(({ hash }) => window.__daymo.say(hash))`. The page-side `say` function looks up the entry, animates the karaoke subtitle bar word-by-word, awaits `durationMs`, resolves.
4. **events.json** gains `{ type: "say", t: <ms-since-scene-start>, hash, text, durationMs }`. Wall-clock-tracked by the controller — `t` is when `fx.say` was invoked.
5. **`fx.banner` runtime.** Mirrors today's `showCaption`/`hideCaption` already in overlay.ts. Adds an auto-hide timer when `duration` is provided.

## Stitch-time flow

For each scene with `say` events:
- Collect the events from `events.json`.
- Build an ffmpeg filter graph that delays each TTS audio file by its recorded `t` and mixes them:
  ```
  [1:a]adelay=500|500[a1];
  [2:a]adelay=4750|4750[a2];
  [a1][a2]amix=inputs=2[narr]
  ```
- Output a per-scene `.with-audio.webm`.

Scenes with zero say events bypass this — their original webm is used directly.

After concat, mix background music:
- `music_duck: true` (default): use `sidechaincompress` to auto-duck music against the narration track. Voice automatically lowers music.
- `music_duck: false`: fall back to today's constant volume (0.4).

If a stitch finds a missing `<hash>.mp3` (cache deleted between capture and stitch), error with `missing TTS audio for scene N: <hash> ("<excerpt>"). Re-run: daymo capture <file> --scene N`.

## State changes

`SceneState` collapses from `pending | captured | approved` to `pending | captured`.

- `EditorState.allApproved` removed.
- `StateAction.approve` removed from the reducer.
- Editor UI's approve checkbox removed; UI becomes capture + preview only.
- Stitch no longer gates on approval. **It does still gate on completeness** — if any scene is in `pending` state (never captured), `daymo stitch` (and the editor stitch endpoint) errors with the list of missing scene indices and suggests `daymo capture <file> --all`. This replaces the implicit "all approved → all captured" guarantee approval used to provide.
- Persisted `state.json` from older versions: on load, any `state: "approved"` is coerced to `"captured"`. One-line backcompat in `loadState`.

## Errors

| Condition | Behavior |
|---|---|
| TTS network/rate-limit | Retry 3× with exponential backoff. Still failing → error with offending text + provider error message. Capture aborted, nothing written. |
| Non-literal `fx.say(...)` arg | Pre-synthesis throws `fx.say requires a string literal: <file:line> "<excerpt>"`. |
| Cache mp3 exists, timings missing/corrupt | Treat as miss; re-synthesize; overwrite both files. |
| Stitch finds missing TTS file | Error names which scene + hash; suggests re-capture command. |
| Two `fx.say` started in parallel without awaiting first | Browser-side queue serializes them (subtitle bar is single-channel). Documented in fx.ts. |

## Testing

- **Unit:** `tts/cache.ts` (hash determinism, hit/miss); `tts/edge.ts` (mock the WebSocket — fixture-based); `core/store.ts` reducer (post-approval-removal); karaoke timing math; pre-synthesis literal scanner.
- **Integration:** `daymo capture` end-to-end on a tiny demo with one `fx.say` and a `--tts-provider mock` flag (returns 1s of silence + fake timings) — verifies webm produced, events.json offset correct, stitched mp4 has audio track of expected duration.
- **CLI/editor parity:** spin up editor, POST /capture/0; in the same demo dir, run `daymo capture demo --scene 1`; assert resulting `.daymo/captures/` is byte-identical (modulo internal timestamps).
- **Migration helper:** unit tests for `daymo migrate-prose` — wrap, idempotent on already-migrated files.
- **End-to-end:** the two existing repo demos (`screenassist-tour.demo`, `screenassist-app-tour.demo`) get migrated as part of this work and rendered via `daymo render` to verify audible output.

## Migration / backwards compat

- Demos without `fx.say` calls render unchanged. No audio track added. Zero regression risk.
- Demos using prose-as-banner: prose stops auto-rendering. Three migration paths:
  - Run `daymo migrate-prose <file>` to wrap each scene's prose in `await fx.say(...)` at top of the playwright block.
  - Delete the prose if not wanted.
  - Manually `fx.banner(prose)` if banner wanted without voice.
- The two repo demos get migrated and verified during this work.
- Persisted `state.json` with `state: "approved"` coerced to `"captured"` on load.

## Out of scope (v1)

- Paid TTS providers (ElevenLabs, OpenAI, Azure). Provider abstraction is in place; concrete implementations later.
- Local-fallback TTS engine (PowerShell `System.Speech` / `say` / `espeak-ng`). Edge TTS only in v1.
- Runtime (non-literal) `fx.say` arguments. Pre-synthesis-only in v1.
- `fx.say` SSML pass-through (`<break>`, `<emphasis>`). Plain text only in v1.
- Multi-channel narration (two voices at once). Subtitle bar is single-channel; calls serialize.
