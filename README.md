# Daymo

Turn a `.demo` markdown file into a polished demo video. Daymo drives your real frontend through a real browser, captures the run with overlays, an animated cursor, and on-screen captions, and produces an MP4 with optional background music.

## Install

No install required:

```bash
npx daymo render path/to/demo.demo
```

A global install is also supported:

```bash
npm install -g daymo
daymo render path/to/demo.demo
```

System dependencies:

- **Node.js ≥ 20.10**
- **ffmpeg** in `PATH` — `brew install ffmpeg` or `apt install ffmpeg`
- **Chromium** — installed automatically by Playwright on first run

Run `npx daymo doctor` to verify all of the above.

## Commands

```
daymo render <file>                              Execute the demo and produce output.mp4
daymo doctor                                     Verify Playwright and ffmpeg are configured
daymo edit <file>                                Open the visual editor for a .demo file

daymo capture <file> --scene N | --all           Capture one scene (1-indexed) or all scenes
daymo stitch <file>                              Compose all captured scenes into output.mp4
daymo state <file> [--json]                      Show scene status table (or JSON)
daymo set-prose <file> --scene N --text "…"      Rewrite a scene's prose markdown
daymo migrate-prose <file>                       Wrap existing prose into fx.say() calls
```

Outputs land in `./artifacts/<id>/` for `daymo render`, or in `<demo-dir>/output.mp4` for `daymo stitch`. The state directory `<demo-dir>/.daymo/` holds per-scene captures (`captures/`), state (`state.json`), and the TTS audio cache (`tts/`).

## The `.demo` file format

A `.demo` file is markdown with YAML frontmatter. Headings define **scenes**. Each scene contains prose (rendered as on-screen captions during the scene), a fenced ` ```playwright ` code block (the actions to execute), and optional fenced ` ```overlay ` blocks (callouts and highlights).

### Frontmatter

| Key | Required | Description |
|---|---|---|
| `title` | yes | Demo title |
| `description` | no | One-line summary |
| `url` | yes | Starting URL — local dev server, staging, or prod |
| `viewport` | no | `{ width, height }` — defaults to 1440×900 |
| `music` | no | Path (relative to the `.demo` file) to a background music mp3 |
| `mocks` | no | Inline mock sources (see below) |
| `auth` | no | `{ storageState: "./auth.json" }` to load cookies + localStorage |

### Scene body

- **`# Heading`** — scene title, displayed in the caption banner during the scene
- **Prose** — descriptive markdown documentation. Not auto-rendered or auto-narrated. To narrate prose, wrap it in `fx.say(...)` inside the playwright block (or run `daymo migrate-prose <file>` to do it mechanically). To show as a static banner, use `fx.banner(...)`.
- **` ```playwright `** — JavaScript executed against `page` (Playwright `Page`), `fx` (the Daymo fx runtime), and `console`
- **` ```overlay `** — declarative overlays parsed as YAML
- **`---`** — scene break (also the frontmatter delimiter)

### `fx` runtime

```ts
fx.cursorTo(selector, { duration?: number })
fx.typeWithDelay(selector, text, cps?: number)
fx.zoom(selector, factor?: number, duration?: number)
fx.pause(seconds: number)
fx.callout(text: string, target?: string, duration?: number)
fx.highlight(selector: string, duration?: number)
fx.say(text: string, opts?: { voice?: string; rate?: string })
fx.banner(text: string, opts?: { duration?: number; title?: string })
fx.hideBanner()
```

### Narration with `fx.say`

Daymo can narrate scenes using free Edge TTS. Inside a `playwright` block:

```js
// Sequential narration — voice finishes, then click
await fx.say("Click the new project button to begin.");
await page.click("[data-testid='new-project-btn']");

// Parallel — voice plays while cursor moves
const n = fx.say("Welcome back, Alex. Your dashboard.");
await fx.cursorTo("h1");
await fx.pause(0.5);
await n;
```

While the voice plays, a karaoke-style subtitle bar shows the sentence with the currently-spoken word highlighted. The first time a string is synthesized, it's cached at `<demo-dir>/.daymo/tts/<hash>.mp3` — re-renders are cache hits.

**Constraint:** the text passed to `fx.say` must be a string literal (not a template literal or variable).

Frontmatter overrides (all optional):

```yaml
tts:
  voice: en-US-AriaNeural
  rate: "+0%"
  music_duck: true   # auto-lower bg music while voice plays
```

For an opt-in static caption banner (the old auto-prose behavior), use `fx.banner(text, { duration?: seconds, title?: string })`.

### Pipeline: `render` vs `capture` + `stitch`

`daymo render` runs everything in one shot but does not yet per-scene-mix narration audio. For TTS-narrated demos, use the two-step pipeline:

```bash
daymo capture my.demo --all
daymo stitch my.demo
```

### Mock declaration

Inline mocks for ≤ 5 routes:

```yaml
mocks:
  - source: inline
    routes:
      "GET /api/me": { "name": "Alex", "plan": "free" }
      "POST /api/projects":
        status: 201
        body: { "id": "p1" }
```

External JSON for larger mock sets:

```yaml
mocks:
  - source: inline
    file: ./mocks.json
```

## Worked example

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

# Welcome to your dashboard

Welcome back, Alex. This is your project dashboard — the home base for everything you build.

```playwright
await page.waitForSelector("h1:has-text('Projects')");
```

```overlay
type: callout
target: "[data-testid='new-project-btn']"
text: "Click here to start a new project"
duration: 2.5s
```

---

# Open the new-project dialog

Click **New Project** to open the creation dialog.

```playwright
await fx.cursorTo("[data-testid='new-project-btn']");
await page.click("[data-testid='new-project-btn']");
await page.waitForSelector("[role='dialog']");
```
````

## Tips for AI agents authoring `.demo` files

- Prefer accessible selectors (`getByRole`, `[aria-label=...]`) over brittle `[data-testid=...]` chains when the codebase uses them.
- Mock every network call the demo will hit — Daymo runs against the real frontend, so unmocked calls will fall through to the real network.
- Keep the prose tight. Two short sentences per scene render better as captions than a long paragraph.
- Don't write assertions. Daymo isn't a test framework.
