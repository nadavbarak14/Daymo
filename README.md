# Daymo

Daymo turns a `.demo` markdown file into product help — driven by your **real** frontend through a real browser. From one set of `.demo` scripts you can build:

1. **Polished demo videos** — narrated MP4s with an animated cursor, overlays, on-screen captions, and optional background music.
2. **A self-hostable help center** — a gallery of how-to videos plus a grounded "How do I…?" chat that answers in your product's own words and jumps to the exact clip that shows the answer.
3. **A CI canary** — `daymo check` runs every script against the live UI (no recording) and fails the build when a demo no longer matches the app.

Because every artifact comes from the same scripts running against your actual app, your help content can't quietly drift away from the product.

> **Authoring with Claude Code:** `.demo` files are plain markdown + Playwright. They're designed for an AI coding agent to write *for* you — point Claude Code at your app, let it draft the scripts, then `daymo check` keeps them honest. See [Authoring demos with an AI agent](#authoring-demos-with-an-ai-agent).

---

## Contents

- [Install](#install)
- [Quickstart: your first demo video](#quickstart-your-first-demo-video)
- [The `.demo` file format](#the-demo-file-format)
- [The `fx` runtime](#the-fx-runtime)
- [Narration with `fx.say`](#narration-with-fxsay)
- [Structuring long scenes into steps](#structuring-long-scenes-into-steps)
- [Mocking network calls](#mocking-network-calls)
- [Authoring demos with an AI agent](#authoring-demos-with-an-ai-agent)
- [Build a help center for your site](#build-a-help-center-for-your-site)
- [Keeping demos valid in CI (`daymo check`)](#keeping-demos-valid-in-ci-daymo-check)
- [Command reference](#command-reference)
- [Package exports](#package-exports)
- [Worked example](#worked-example)

---

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

For the **help-center chat** you also need a **Google Generative AI API key** (used for embeddings at index time and at query time) — set `GEMINI_API_KEY` for the CLI and `GOOGLE_GENERATIVE_AI_API_KEY` for your app's chat route. Video rendering and `daymo check` need no API key.

---

## Quickstart: your first demo video

```bash
daymo render path/to/demo.demo
```

This launches Chromium, runs the demo against the URL in its frontmatter, and writes `./artifacts/<id>/output.mp4`.

For **narrated** demos (anything using `fx.say`), use the two-step pipeline so audio is mixed per scene:

```bash
daymo capture path/to/demo.demo --all
daymo stitch path/to/demo.demo        # writes output.mp4 + captions.vtt next to the .demo
```

The state directory `<demo-dir>/.daymo/` holds per-scene captures (`captures/`), state (`state.json`), and the TTS audio cache (`tts/`). Re-runs are cache hits.

---

## The `.demo` file format

A `.demo` file is markdown with YAML frontmatter. Headings define **scenes**. Each scene contains prose (documentation), a fenced ` ```playwright ` code block (the actions to execute), and optional fenced ` ```overlay ` blocks (callouts and highlights).

### Frontmatter

| Key | Required | Description |
|---|---|---|
| `title` | yes | Demo title |
| `description` | no | One-line summary (shown on the gallery card + used by chat) |
| `url` | yes | Starting URL — local dev server, staging, or prod |
| `viewport` | no | `{ width, height }` — defaults to 1440×900 |
| `music` | no | Path (relative to the `.demo` file) to a background music mp3 |
| `mocks` | no | Inline mock sources (see [Mocking network calls](#mocking-network-calls)) |
| `auth` | no | `{ storageState: "./auth.json" }` to load cookies + localStorage |
| `tts` | no | `{ voice, rate, music_duck }` narration overrides |

### Scene body

- **`# Heading`** — scene title, displayed in the caption banner during the scene
- **Prose** — descriptive markdown. Not auto-rendered or auto-narrated. To narrate, wrap it in `fx.say(...)`; to show as a static banner, use `fx.banner(...)`.
- **` ```playwright `** — JavaScript executed against `page` (Playwright `Page`), `fx` (the Daymo runtime), and `console`
- **` ```overlay `** — declarative overlays parsed as YAML
- **`---`** — scene break (also the frontmatter delimiter)

> **Each scene captures from a fresh load of `url`.** Scenes are independent clips, stitched in order. A multi-step flow that depends on earlier state (open a dialog → fill it → submit) must live in **one scene**, broken up with `fx.step(...)` — see [Structuring long scenes into steps](#structuring-long-scenes-into-steps).

---

## The `fx` runtime

```ts
fx.cursorTo(selector, description, { duration?: number })   // animate the cursor to a target
fx.click(selector, description, opts?)                       // click (records the action)
fx.typeWithDelay(selector, text, cps?: number)               // type with a cinematic per-char delay
fx.zoom(selector?, factor?: number, duration?: number)       // zoom to a target (no selector = full page)
fx.highlight(selector, description, { duration?, color? })   // pulse-highlight an element
fx.callout(text, target?, duration?)                         // floating callout, optionally anchored
fx.pause(seconds)                                            // hold the frame
fx.say(text, { voice?, rate? })                              // narrate (Edge TTS) with karaoke subtitles
fx.banner(text, { duration?, title? })                       // static caption banner
fx.hideBanner()
fx.step(description)                                          // mark a named sub-step (outline + chat anchor)
fx.waitForSelector(selector, opts?)
fx.waitForLoadState(state?)
fx.waitForURL(url, opts?)
```

Targets are resolved through Playwright's **locator engine**, so the full selector syntax works everywhere — `text=`, `:has-text()`, `role=`, `xpath=`, and CSS — not just for `page.click` but for cursor moves, highlights, and zooms too.

`cursorTo` and `highlight` **require a description** as the second argument. It documents the action, surfaces in the editor, and is what the CI canary reports when a selector breaks.

---

## Narration with `fx.say`

Daymo narrates scenes using free Edge TTS. Inside a `playwright` block:

```js
// Sequential — voice finishes, then click
await fx.say("Click the new project button to begin.");
await page.click("[data-testid='new-project-btn']");

// Parallel — voice plays while the cursor moves
const n = fx.say("Welcome back, Alex. Your dashboard.");
await fx.cursorTo("h1", "the dashboard heading");
await fx.pause(0.5);
await n;
```

While the voice plays, a karaoke-style subtitle bar shows the sentence with the currently-spoken word highlighted. The first time a string is synthesized it's cached at `<demo-dir>/.daymo/tts/<hash>.mp3` — re-renders are cache hits.

**Constraint:** the text passed to `fx.say` must be a string literal (not a template literal or variable).

Frontmatter overrides (all optional):

```yaml
tts:
  voice: en-US-AriaNeural
  rate: "+0%"
  music_duck: true   # auto-lower bg music while voice plays
```

---

## Structuring long scenes into steps

A long scene (a 20-minute walkthrough is fine as one scene) becomes hard to navigate as a single block. Wrap user-visible actions with `fx.step("…")` to give the editor, the chat index, and any reviewer a narrative outline:

```js
await fx.step("Open the new-project dialog");
await fx.cursorTo("[data-testid=new-project-btn]", "the New Project button");
await page.click("[data-testid=new-project-btn]");
await fx.say("Click here to start a new project.");
await page.waitForSelector("[role=dialog]");

await fx.step("Name the project");
await page.fill("[name=projectName]", "My first project");
await fx.say("Give it a name.");
```

Each `fx.step` opens a new step; every following statement belongs to it until the next `fx.step` (or the end of the block). **Steps are the unit the chat answers in** — a "How do I name a project?" question links to the clip starting at that step.

**Rules** (enforced at parse time):

- The argument must be a string literal — no template strings, no variables.
- At most one `fx.say` per step. If you'd narrate two different lines, those are two different steps.
- At most one `fx.banner` per step.
- `fx.step` is optional. A scene with no `fx.step` calls behaves exactly as before.

---

## Mocking network calls

Daymo runs against your real frontend, so any unmocked call falls through to the real network. Mock what a demo shouldn't really hit.

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

External JSON for larger mock sets (path is relative to the `.demo` file):

```yaml
mocks:
  - source: inline
    file: ./mocks.json
```

> Server-rendered actions (e.g. Next.js Server Actions) can't be intercepted from the browser. For those flows, run the demo against a real seeded environment and use `auth.storageState` for a logged-in session.

---

## Authoring demos with an AI agent

`.demo` files are intentionally a format an AI coding agent can write well: plain markdown, real Playwright, no bespoke DSL. A productive loop with Claude Code:

1. **Point it at your app.** "Here's my app running at `http://localhost:3000`, logged in as a test user. Write a Daymo `.demo` that shows how to create a project." The agent inspects the DOM, picks selectors, and drafts the scenes.
2. **Let it structure the flow.** Remind it of the two rules that trip up first drafts: one scene per stateful flow, broken into `fx.step(...)`; at most one `fx.say` per step.
3. **Verify with the canary, not by watching.** Run `daymo check path/to.demo` (no recording, seconds to run). It fails on the first broken selector and names the step + `file:line`, so the agent can fix scripts in a tight loop before you ever render a pixel.
4. **Render once you're happy.** `daymo capture --all && daymo stitch` produces the reviewable video.

### Tips to put in your prompt

- Prefer accessible selectors (`getByRole`, `[aria-label=...]`, `text=`) over brittle `[data-testid=...]` chains — Daymo resolves all of them.
- Mock every network call the demo will hit, or run against a seeded environment.
- Keep narration tight — two short sentences per step read far better than a paragraph.
- Don't write assertions. Daymo is not a test framework; the canary checks liveness, not correctness.
- One `fx.step` = one logical user action (cursor + click + say + wait).

---

## Build a help center for your site

A Daymo help center is two surfaces over the **same** published bundle:

- a **gallery** of how-to videos (from `manifest.json`), and
- a **chat** that semantically searches your steps and answers with text + the exact video clip (`#t=start,end`) that demonstrates it (from `index.json`).

```
 .demo scripts ──render──▶ output.mp4 + poster.jpg + captions
        │
        └──daymo index──▶ index.json (embeddings) + config.json   ┐
        └──daymo publish─▶ manifest.json + index.json + videos ────┼──▶ a static bundle
                                                                   ┘
 bundle ──served at <baseUrl>──▶  <HelpCenter/> gallery + chat route
```

### 1. Lay out demos folder-per-demo

```
demos/
  01-create-project/01-create-project.demo
  02-share-project/02-share-project.demo
  mocks/ai-ask.json
  auth.json
```

Each demo keeps its own `.daymo/`, `output.mp4`, and `poster.jpg` in its own folder, so one `daymo index demos/` builds a whole widget. Render each demo (`daymo capture --all && daymo stitch`).

### 2. Index for search

```bash
GEMINI_API_KEY=… daymo index demos/ \
  --widget-id myapp-help \
  --widget-name "MyApp Help" \
  --allowed-origins "https://myapp.com" \
  --video-base-url /help
```

This embeds every step, writes `index.json` + `config.json` into `$DAYMO_DATA_ROOT/widgets/<id>/` (default `~/.daymo-chat-data`), and copies each demo's video/poster/captions in. `--video-base-url` is baked into `index.json` so chat clips resolve to wherever you'll host the videos.

### 3. Publish the bundle

```bash
daymo publish --widget-id myapp-help --out public/help
```

The default uploader writes `manifest.json`, `index.json`, and `<demoId>/{output.mp4,poster.jpg,output.vtt}` into the output directory. Point `--out` at your app's `public/help/` for **zero-infra** hosting (videos served same-origin), or swap in an S3/R2 uploader to move the (only real cost) video egress onto a cheap-egress CDN. The `Uploader` interface is a single `put(key, body, contentType)` method — an S3/R2 implementation is a drop-in replacement for the directory uploader.

### 4. Mount the gallery + chat UI

**React:**

```tsx
import { HelpCenter } from "daymo/react";
import "daymo/help-center.css";

export default function HelpPage() {
  return (
    <HelpCenter
      manifestUrl="/help/manifest.json"
      chatEndpoint="/api/help/chat"
      title="Help center"
    />
  );
}
```

**Any framework (vanilla):**

```ts
import { mountHelpCenter } from "daymo/help-center";
import "daymo/help-center.css";

const unmount = mountHelpCenter(document.getElementById("help")!, {
  manifestUrl: "/help/manifest.json",
  chatEndpoint: "/api/help/chat",
  title: "Help center",
});
```

The gallery renders poster cards that expand to the video on click; the chat posts `{ message, history }` to `chatEndpoint` and renders the response — including inline video clips trimmed to the answering step via a media fragment.

### 5. Wire the chat route

**Next.js — one call** (`app/api/help/chat/route.ts`):

```ts
import { createHelpChatRoute } from "daymo/next";

export const POST = createHelpChatRoute({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
});
```

That's the whole route. `createHelpChatRoute` resolves the index, builds the Gemini deps from your key, memoizes across warm requests, and returns a 503 (that retries on the next request) if a cold start fails. **Index resolution order:** an explicit `index` object → `baseUrl` option → `HELP_BASE_URL` env → same-origin `/help/index.json`. So the zero-infra default — bundle in `public/help`, videos served by the app — needs no configuration; setting `HELP_BASE_URL` is the single knob that moves the bundle (and video egress) onto a CDN.

Other options: `embeddingModelId` (must match the index), `suggestedQuestions`, `defaultLocale`, `rateLimitPerMinute`, `maxBodyBytes`, `onEvent`.

**Any host (standalone server):** if you're not on Next.js, run the backend yourself:

```bash
GEMINI_API_KEY=… daymo serve --data-root ~/.daymo-chat-data --port 8765
```

and point `chatEndpoint` at it. For finer control inside a custom handler, the lower-level pieces are exported too: `loadIndexSource`, `createGeminiChatDeps`, and `createChatRoute`.

### The chat response shape

```ts
type ChatResponse =
  | { kind: "answer"; parts: Array<
        | { kind: "text"; text: string }
        | { kind: "video"; mp4Url; startMs; endMs; caption; stepId; demoId }
      > }
  | { kind: "no_match"; text: string; suggestions?: string[] };
```

---

## Keeping demos valid in CI (`daymo check`)

Rendered videos are **content** — you author them, watch them, and commit the result; they rarely change, so you don't re-render in CI. But a how-to script can silently go stale when the UI moves (a renamed button, a changed field id). `daymo check` is the canary: it runs every demo through the *real* flow — clicks, typing, waits, and selector resolution for every `fx.cursorTo`/`highlight`/`zoom` — with **recording, narration, overlays, and pauses stripped**. It records nothing; it just fails fast when a selector no longer resolves.

Because it drives the real app, run it in the e2e job you already have, after the app is up and seeded — no extra infrastructure:

```yaml
# in your existing Playwright/e2e job, once the app is serving:
- run: npx daymo check demos/ --base-url "$APP_URL"
```

- `[path]` defaults to `./demos`; accepts a directory (searched recursively) or a single `.demo`.
- `--base-url <url>` swaps the **origin** of each demo's frontmatter `url` (keeping its path/query) so CI can point demos at whatever host/port it serves on.
- `--timeout <ms>` is the per-action + navigation timeout (default 15000) — a broken selector fails in seconds instead of hanging.
- `--json` emits `{ ok, demos: [...] }` for CI annotations.

Exit code is `0` only if every demo passes; any break exits `1`. A failure names the demo, the `fx.step` it broke on, the selector, and the source `file:line`:

```
✓ 01-create-course      4 steps  1.9s
✗ 03-create-document    step 2 "Title it"
    selector not found: #title
    demos/03-create-document/03-create-document.demo:22

1 of 4 demos broken → exit 1
```

Because `check` reuses the same controller that capture does, the canary can't drift from what real rendering executes.

---

## Command reference

```
daymo render <file> [--out <dir>]                Execute the demo → output.mp4
daymo capture <file> --scene N | --all           Capture one scene (1-indexed) or all
daymo stitch <file>                              Compose captured scenes → output.mp4 (+ captions)
daymo check [path] [--base-url] [--timeout] [--json]
                                                 Run demos with no recording; fail if a script broke
daymo doctor                                     Verify Playwright + ffmpeg are configured
daymo edit <file> [--port] [--no-open]           Open the visual editor for a .demo file
daymo state <file> [--json]                      Show scene status table (or JSON)
daymo set-prose <file> --scene N --text "…"      Rewrite a scene's prose markdown
daymo migrate-prose <file>                       Wrap existing prose into fx.say() calls
daymo manual <file> [--out <path>] [--stdout]    Generate a text manual.md (no browser)

# Help-center pipeline
daymo index <demoDir> --widget-id <id> --allowed-origins <list> [--widget-name] [--locale]
            [--brand-color] [--video-base-url] [--embedding-model] [--data-root]
                                                 Build the search index from a demo directory
daymo publish --widget-id <id> --out <dir> [--version] [--data-root]
                                                 Assemble manifest.json + index.json + videos
daymo serve [--port] [--host] [--data-root] [--base-url] [--rate-limit] [--admin-token]
                                                 Run the standalone chat backend
```

Outputs land in `./artifacts/<id>/` for `daymo render`, or in `<demo-dir>/output.mp4` for `daymo stitch`. The help-center pipeline writes to `$DAYMO_DATA_ROOT` (default `~/.daymo-chat-data`). `daymo index` and `daymo serve` need `GEMINI_API_KEY`; the rest need no API key.

### `render` vs `capture` + `stitch`

`daymo render` runs everything in one shot but does not per-scene-mix narration audio. For TTS-narrated demos, use `capture --all` then `stitch`.

---

## Package exports

`daymo` is both a CLI and a library. Subpath exports:

| Import | Purpose |
|---|---|
| `daymo` | Core types and programmatic APIs |
| `daymo/next` | `createHelpChatRoute`, `loadIndexSource`, `createGeminiChatDeps`, `createChatRoute` — Next.js / fetch-handler chat route |
| `daymo/react` | `<HelpCenter>` React component |
| `daymo/help-center` | `mountHelpCenter(container, opts)` — framework-agnostic vanilla mount |
| `daymo/help-center.css` | Default stylesheet for the gallery + chat |

The package ships with `prepare: tsc`, so it is **git-installable** directly (no separate build step on the consumer side).

---

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
      "POST /api/projects":
        status: 201
        body: { "id": "p1" }
---

# Onboarding

```playwright
await fx.step("Welcome the user");
await page.waitForSelector("h1:has-text('Projects')");
await fx.say("Welcome back, Alex. This is your project dashboard.");

await fx.step("Open the new-project dialog");
await fx.cursorTo("[data-testid=new-project-btn]", "the New Project button");
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

Render it:

```bash
daymo capture create-project.demo --all
daymo stitch create-project.demo
```

…then drop it in a `demos/` folder and follow [Build a help center for your site](#build-a-help-center-for-your-site) to turn it into a searchable, chat-answerable help page.
