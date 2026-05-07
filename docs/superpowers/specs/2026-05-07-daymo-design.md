# Daymo — Design Document

**Date:** 2026-05-07
**Status:** Draft for review

## Goal

Build a tool that turns a single human-readable file (`.demo` markdown) into a polished demo video. Authoring is AI-driven: the user prompts Claude Code (or any agent), which writes the file. The tool drives the user's real frontend through a real browser, captures interaction with cursor and overlays injected live, and produces an MP4 with TTS narration and music.

The same file, the same output, regardless of whether the author is a developer (writing it themselves) or a non-developer (prompting Claude Code).

## Audience

Engineering-adjacent teams who:

- have a frontend they can run locally or via URL (any framework — React, Vue, Svelte, etc.)
- already use AI coding agents (Claude Code, etc.) in their workflow
- need demos for landing pages, sales emails, onboarding flows, internal docs, or YouTube guides

Examples: small/mid SaaS teams, dev-tools companies, AI-native startups, internal docs/devops teams.

Explicitly **not** the audience: enterprise sales/marketing teams whose buyers don't touch a code repo. They are better served by Arcade/Storylane.

## Why this product, why now

- **Agent-first authoring.** Existing demo tools (Arcade, Storylane, Supademo) are recording-first: capture clicks, edit in a SaaS UI. Daymo is the opposite — describe the demo, an agent generates a portable file. This sidesteps the "click-and-edit" UX entirely. Possible now because LLMs in 2026 author Playwright code and structured markdown reliably.
- **Portable, version-controlled file format.** A `.demo` file lives in a git repo (or anywhere). It's diff-able, AI-editable, and renders as readable docs on GitHub. No backend lock-in.
- **Real frontend, mocked backend.** The demo *is* the real running app, just with the network mocked. Demos look exactly like production because they are production. Backend can be broken, half-built, or absent.
- **Tractable to ship.** v0.1 is ~500 LoC of pipeline glue over mature dependencies (Playwright, ffmpeg, an off-the-shelf TTS API). No novel research. Weeks not months to a working MVP.

## Non-goals

- **Replace WYSIWYG demo tools** (Arcade, Storylane) for sales/marketing teams who don't use AI agents. Different audience, different product.
- **Mobile-native demos** (iOS/Android). Web only. We rely on Playwright; if it doesn't run in a browser, we don't demo it.
- **A test framework.** Demos are not assertions. Daymo will not retry on failure, won't fail builds, won't pretend to validate correctness.
- **A hosted SaaS, billing, multi-user collaboration.** v0.1 is a CLI + library. Hosted UI is a deferred consideration, not part of v0.1.

## Deferred to later versions

| Version | Feature |
|---|---|
| v0.2 | HAR recorder mode — record a real session once, replay forever (friendlier for non-devs who can't author mocks) |
| v0.2 | Chat-queryable how-to layer — RAG over the prose narration of demos in a library; embeddable widget |
| v0.2 | Higher-quality post-video compositing — smooth pan/zoom, vector-quality text overlays |
| v0.3 | Static-frame mode (slideshow of pre-captured screenshots) and component-only mode (Storybook-style isolated rendering) |
| v0.3 | Hosted web UI for non-engineering users to author and render without a local CLI |

## Architecture

```
┌─────────────────────┐       ┌──────────────────┐       ┌────────────────┐
│  Claude Code / CLI  │──────▶│   .demo file     │──────▶│  Demo runner   │
│  (authoring)        │       │   (markdown)     │       │  (orchestrator)│
└─────────────────────┘       └──────────────────┘       └───────┬────────┘
                                                                  │
                              ┌───────────────────────────────────┴───────────────┐
                              ▼                                                   ▼
                      ┌──────────────┐                                 ┌────────────────────┐
                      │  Playwright  │   captures raw page video       │   Compositor       │
                      │  controller  │ + events.json + auth state ──▶  │   (ffmpeg)         │
                      │              │                                 │                    │
                      └──────┬───────┘                                 └─────────┬──────────┘
                             │                                                   │
                             ▼                                                   ▼
                      ┌──────────────┐                                       output.mp4
                      │  Mock layer  │
                      │  (inline /   │
                      │  HAR-replay) │
                      └──────────────┘
```

Five components, each with one job, decoupled by an artifact directory:

1. **`.demo` file** — markdown source of truth (YAML frontmatter + scenes with prose, Playwright code blocks, overlay directives)
2. **Demo runner** — parses the file, orchestrates everything else, writes artifacts to disk
3. **Playwright controller** — launches a Chromium instance, applies auth state, sets up mocks, executes scene actions in a sandbox, records raw page video + event log
4. **Mock layer** — pluggable mock sources behind a single interface (v0.1: inline mocks only)
5. **Compositor** — reads the artifact directory, generates TTS narration, mixes with music, encodes final MP4 with ffmpeg

The runner and compositor communicate **only through an artifact directory** on disk (`./artifacts/<demo-id>/`). This means capture and render can be debugged and re-run independently — if the video looks wrong, we don't re-run Playwright.

## The `.demo` file format

A `.demo` file is markdown with YAML frontmatter. Headings define scenes. Each scene contains prose narration, fenced code blocks for Playwright actions, and fenced directive blocks for overlays.

````markdown
---
title: Create your first project
description: Walks a new user through creating their first project in Daymo.
url: http://localhost:3000
viewport: { width: 1440, height: 900 }
voice: en-US-emma
music: gentle-corporate.mp3
mocks:
  - source: inline
    routes:
      "GET /api/me": { "name": "Alex", "plan": "free" }
auth:
  storageState: ./auth.json
---

# Welcome to your dashboard

Welcome back, Alex. This is your project dashboard — the home base for everything you build in Daymo.

```playwright
await page.goto("/dashboard");
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

### What each piece does

| Element | Purpose |
|---|---|
| YAML frontmatter | Global config: starting URL, viewport, voice, music, mock sources, auth state |
| `# Heading` | Scene title — the section name in the voiceover and a chunk title for future retrieval (v0.2 chat layer) |
| Prose under heading | Two jobs: TTS reads it aloud as narration; embeddings index it for "how to" search later |
| ` ```playwright ` block | Actions to execute. Standard Playwright `page` API plus an `fx` helper namespace for demo-specific operations |
| ` ```overlay ` block | Declarative creative layer: callouts, highlights, dwells, zooms |
| `---` | Scene break — visual breathing room and a parser delimiter |

### Why markdown

- **Heading + prose = retrieval-ready by construction.** When the chat layer ships in v0.2, every scene is already a perfectly-shaped chunk: title, body, timestamp.
- **Renders as a docs page on GitHub.** The file is itself a readable how-to article without rendering. The video is a richer rendering of the same content.
- **LLMs author this format better than any other.** Structured markdown with embedded fenced code blocks is the format LLMs produce most reliably.
- **Trivial to parse.** Heading splits, frontmatter parsing, fence parsing — all well-known.

### Mock declaration

For ≤5 mocked routes, mocks live inline in the frontmatter (as shown above). For larger mock sets, the frontmatter references an external file:

```yaml
mocks:
  - source: inline
    file: ./mocks.json
```

In v0.2, additional mock sources unlock:

```yaml
mocks:
  - source: har
    file: ./session.har
  - source: live
    baseUrl: http://staging.example.com
```

## Execution model

The runner is a small Node.js script (~300 LoC) that uses the Playwright **library** (not the test runner) directly. We do not use the test runner because demos are not assertions — semantics like auto-retry, pass/fail, and trace files don't fit.

Run order:

```
1. Parse  .demo file       → AST  { frontmatter, scenes[] }
2. Boot   Playwright       → browser + context + page
3. Apply  init script      → injects cursor SVG, callout layer, highlight CSS
4. Apply  mocks            → inline route handlers from frontmatter
5. Apply  auth             → context loads storageState (cookies + localStorage)
6. Start  capture          → context.video on; runner opens events.json
7. For each scene:
     a. Mark t_scene_start in events.json with scene title and prose
     b. Execute the scene's `playwright` block in a sandbox with { page, fx, console }
     c. Each `overlay` directive is emitted as an event with t_start, target bbox, params
     d. Mark t_scene_end
8. Stop   capture          → save raw_page.webm
9. Hand off to compositor with: raw_page.webm + events.json + scene narration text
```

### Sandbox: how Playwright code blocks are executed

Each scene's code block is wrapped and executed via the `AsyncFunction` constructor:

```ts
async function runSceneBlock(code: string, ctx: { page, fx, console }) {
  const fn = new AsyncFunction("page", "fx", "console", code);
  await fn(ctx.page, ctx.fx, ctx.console);
}
```

- `page` — the real Playwright `Page` object
- `fx` — our runtime API (cursor animation, realistic typing, zoom, callout); ~150 LoC, all in TS
- `console` — captured logger; output goes to events.json for debugging

When a block throws, the error is wrapped with the source line number from the markdown so the user sees:

```
Error in scene "Open the new-project dialog" line 12:
  locator '[data-testid=new-project-btn]' not found
```

### The `fx` namespace

```ts
interface DemoFx {
  cursorTo(selector: string, opts?: { duration?: number }): Promise<void>;
  typeWithDelay(selector: string, text: string, cps?: number): Promise<void>;
  zoom(selector: string, factor?: number, duration?: number): Promise<void>;
  pause(seconds: number): Promise<void>;
  callout(text: string, target?: string, duration?: number): Promise<void>;
  highlight(selector: string, duration?: number): Promise<void>;
}
```

Each helper does two things at once: animate the visible page (via `page.evaluate` calls into the injected overlay manager), and emit an event into the log so the compositor knows what happened when.

## Visual overlays: in-browser injection

For v0.1, all visual overlays are injected into the page at recording time and captured live by Playwright's video recording. **No post-video visual compositing.**

Mechanism: `context.addInitScript()` registers a small script that runs on every page load, before page scripts. It injects:

- An absolutely-positioned SVG cursor element
- A callout layer (positioned text bubbles with arrows)
- Highlight CSS class for outlining elements

The runner then issues commands via `page.evaluate(...)` to manipulate the injected overlay manager (move the cursor, add a callout, highlight an element). CSS transitions handle the animations natively; Playwright records at the browser's native frame rate.

| Overlay | Where rendered | Notes |
|---|---|---|
| Cursor | In-browser (injected SVG) | Tracks DOM elements through scroll/layout shift |
| Element highlight | In-browser (CSS outline) | Toggle a class on the target |
| Callout text | In-browser (HTML overlay div) | v0.1: simple HTML; v0.2 considers post-video for higher quality |
| Zoom | In-browser (CSS transform) | v0.1: `transform: scale(1.5)`; v0.2: smooth pan/zoom in compositor |
| Narration audio | Post-video (TTS + ffmpeg mix) | Browser can't generate TTS |
| Music | Post-video (ffmpeg) | Mixed with narration |

Title cards and scene transitions are not in v0.1. If a demo needs an intro frame, the author writes a scene with prose narration, a `pause`, and a callout — no special title-card primitive needed.

## Audio compositing

The compositor is a thin wrapper over ffmpeg. After capture:

1. **Generate TTS** — for each scene, pass the prose narration to the configured TTS provider (OpenAI TTS, edge-tts, ElevenLabs). Output: one MP3 per scene, plus a concatenated full-narration track with silence padding to match scene timestamps from `events.json`.
2. **Mix** — single ffmpeg invocation:
   ```
   ffmpeg
     -i raw_page.webm
     -i narration.mp3
     -i music.mp3
     -filter_complex "[1:a]volume=1.0[v];[2:a]volume=0.3[m];[v][m]amix=inputs=2[a]"
     -map 0:v -map [a]
     -c:v libx264 -c:a aac
     output.mp4
   ```
3. **Output** — `output.mp4` is the final deliverable. The artifacts directory keeps everything for re-rendering.

## MVP scope (v0.1)

A CLI distributed as an npm package + a Claude Code skill.

### CLI commands

```
daymo init                  Create an example .demo file in the current directory
daymo render <file>         Execute the demo and produce output.mp4
daymo preview <file>        Render at lower fidelity (no TTS, no music) for fast iteration
daymo doctor                Verify Playwright, ffmpeg, and TTS API key are configured
```

### What ships

- `.demo` file format (markdown with frontmatter, scenes, Playwright + overlay blocks)
- Demo runner (parse, sandbox, orchestrate)
- Playwright controller (init script with overlay manager, capture loop)
- `fx` runtime (`cursorTo`, `typeWithDelay`, `zoom`, `pause`, `callout`, `highlight`)
- Inline mock layer
- ffmpeg-based audio compositor
- Claude Code skill (slash command `/demo create <prompt>`) that reads the user's source code or target URL, generates a `.demo` file with appropriate scenes, Playwright actions, and inline mocks, then runs `daymo render` to produce the MP4

### Format details

- **`voice` values** follow the configured TTS provider's voice IDs. The default provider is OpenAI TTS (voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`). Users can switch providers via env var (`DAYMO_TTS_PROVIDER=elevenlabs`) and use that provider's voice IDs. Voice naming is not normalized across providers in v0.1.
- **`music` values** are user-provided file paths relative to the `.demo` file. Daymo does not bundle music. If a music license check is desired, that is the user's responsibility.
- **Mock values** in inline mode accept JSON for the response body. Headers and status default to `200 OK` / `application/json`. Specifying status or custom headers requires the long-form object: `{ status: 404, body: { error: "not found" } }`.

### What does NOT ship in v0.1

- HAR recorder
- HAR-replay mock source
- Live mock source (proxy to real backend)
- Chat-queryable layer
- Hosted web UI
- Static / component rendering modes
- Smooth pan/zoom, vector text overlays
- Background music ducking under narration

## Risks and open questions

1. **TTS quality cliff.** Auto-generated narration that sounds robotic kills the demo. Mitigation: support multiple TTS providers; default to a high-quality one (OpenAI TTS or ElevenLabs); document trade-offs. Open: should we offer "narration off" mode for users to dub manually?
2. **Selector brittleness.** `[data-testid=...]` selectors break when the codebase changes. The Claude Code authoring step should prefer accessible selectors (`getByRole`, `getByLabel`); the runner should give helpful errors with screenshots when a selector misses.
3. **Auth flows.** Login flows that touch external IdPs (Auth0, Clerk, OAuth providers) are very hard to mock. v0.1 punts: the user logs in once manually and saves `storageState` to a file, then the demo loads from that. v0.2 considers a "login recorder" command that captures storageState from a real session.
4. **Mock authoring burden.** Even inline mocks are tedious to write by hand. v0.1 leans entirely on Claude Code to generate plausible mocks from API spec / source code. v0.2's HAR recorder reduces this dramatically.
5. **Distribution.** Even if it works, who installs it? Plan: open-source on GitHub, publish to npm, list in the Claude Code skill marketplace, write a small docs site with examples. Not a hosted product in v0.1, so distribution is dev-channel only.
6. **License of dependencies.** All v0.1 dependencies must be permissively licensed (MIT/Apache/BSD). Confirmed for Playwright (Apache 2.0), ffmpeg (LGPL when dynamically linked), Node, TS. **No Remotion** (commercial license restrictions).

## Definition of done for v0.1

- A user can `npm install -g daymo`, run `daymo init`, edit the `.demo` file or have Claude Code regenerate it, and produce an MP4 of their real local frontend within five minutes.
- The MP4 contains: real page footage, animated cursor, on-screen callouts, TTS narration, optional background music.
- The pipeline is reproducible: same inputs produce visually-identical outputs (modulo TTS API non-determinism).
- The example demo (the one shipped with `daymo init`) demonstrates a complete end-to-end flow including mocks.

## Next steps after this design is approved

Move to writing-plans skill to produce a step-by-step implementation plan.
