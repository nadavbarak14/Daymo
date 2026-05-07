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
daymo render <file>     Execute the demo and produce output.mp4
daymo doctor            Verify Playwright and ffmpeg are configured
```

Outputs land in `./artifacts/<id>/`. The final mp4 is `output.mp4`; the raw page video and events log are kept beside it for re-rendering or debugging.

## v0.2 — split pipeline + polish

The pipeline is split so you can iterate on transitions, slates, and overlays without re-running the browser.

```
daymo capture <file>             Capture page video + events into ./artifacts/<id>/capture/
daymo compose <bundle> [<file>]  Compose output.mp4 from a bundle (re-reads .demo each time)
daymo render <file>              capture + compose (back-compat alias)
```

### New frontmatter keys

| Key | Type | Default | Description |
|---|---|---|---|
| `defaultTransition` | enum | `crossfade` | One of `crossfade`, `dip-to-black`, `slide-left`, `slide-right`, `none` |
| `transitionDuration` | duration | `0.5s` | Default transition length |
| `intro` | object \| `false` | auto | Intro slate. Auto-generated from `title` + `description` |
| `outro` | object \| `false` | auto | Outro slate. Auto-generated from `title` |
| `captureMode` | enum | `continuous` | `continuous` (one browser run) or `per-scene` (one run per scene; enables `--scene <n>`) |

### New scene-level blocks

Override the transition into a specific scene:

````markdown
```transition
type: dip-to-black
duration: 0.8s
```
````

In per-scene mode, override per-scene url/mocks/auth:

````markdown
```scene-config
url: http://localhost:3000/settings
```
````

### New `fx` primitives

```ts
fx.fastForward<T>(fn: () => Promise<T>, factor?: number): Promise<T>   // factor default 3, clamped to [1.5, 16]
fx.skip<T>(fn: () => Promise<T>): Promise<T>
```

Wrap a slow operation. The wrapped region runs at real time during capture; in the final video it's sped up (`fastForward`) or cut entirely (`skip`).

### Per-scene capture mode

Set `captureMode: per-scene` to give each scene its own browser run. Enables:

```
daymo capture <file> --scene <n> --bundle <dir>
```

Re-shoots scene `<n>` into an existing bundle without redoing the others.

### Backwards compatibility

v0.1 `.demo` files render with default crossfades and auto-generated intro/outro slates. To reproduce v0.1 output exactly:

```yaml
defaultTransition: none
intro: false
outro: false
```

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
- **Prose** — rendered as on-screen captions for the duration of the scene
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
