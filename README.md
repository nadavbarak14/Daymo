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
fx.step(description: string)
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

### Structuring long scenes into steps

Long scenes (a 20-minute walkthrough is fine as one scene) become hard to navigate as a single block. Wrap user-visible actions with `fx.step("…")` to give the editor — and any reviewer — a narrative outline:

```js
await fx.step("Open the new-project dialog");
await fx.cursorTo("[data-testid=new-project-btn]");
await page.click("[data-testid=new-project-btn]");
await fx.say("Click here to start a new project.");
await page.waitForSelector("[role=dialog]");

await fx.step("Name the project");
await page.fill("[name=projectName]", "My first project");
await fx.say("Give it a name.");
```

Each `fx.step` opens a new step and every following statement belongs to it until the next `fx.step` (or the end of the block). The description has no visual effect at render time — it shows up in the editor and in `events.json` only.

**Rules** (enforced at parse time):

- The argument must be a string literal — no template strings, no variables.
- At most one `fx.say` per step. If you'd narrate two different lines, those are two different steps.
- At most one `fx.banner` per step.
- `fx.step` is optional. A scene with no `fx.step` calls behaves exactly as today.

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

## The help center page

Daymo ships a full help-center template — a ChatGPT-style help center: a
collapsible **sidebar** (searchable video library), a centered **home**
landing with an inline media player you can watch and populated popular
searches, a **conversation** thread whose answers are structured (a clip cued
to the exact moment → a clickable step list → a "related walkthroughs"
playlist → follow-ups), and a centered **theater** player (video on the left,
steps + an "up next" queue on the right).

```tsx
// app/help/page.tsx
"use client";
import { HelpCenter } from "daymo/react";
import "daymo/help-center.css";

export default function HelpPage() {
  return (
    <HelpCenter
      manifestUrl="/help/manifest.json"
      chatEndpoint="/api/help/chat"
      name="Acme"
      brandColor="#0ea5e9"
      suggestedQuestions={["How do I create a project?", "How do I invite my team?"]}
      contactHref="mailto:support@acme.io"
    />
  );
}
```

No React? `import { mountHelpCenter } from "daymo/help-center"` renders the
same page into any element and returns an unmount function.

### Making it match your product

- **90% case:** set `brandColor` — every accent tint derives from it. Light
  brand colors should also override `--daymo-accent-ink` (the text color used
  on accent surfaces). Dark mode: put `data-daymo-theme="dark"` on any
  ancestor.
- **Voice / i18n:** every visible string is overridable via `strings`
  (e.g. `strings={{ libraryHeading: "Tutorials", lede: "…" }}`).
- **Own layout:** `chrome={false}` drops the sidebar + topbar so you can embed
  the content column (home landing + conversation) inside your own page shell.
- **Everything else:** copy `node_modules/daymo/styles/help-center.css` into
  your project and let your coding agent restyle it — class names are a
  stable API and the behavior never depends on the styles. Two font stacks
  drive the look: a UI sans (`--daymo-font`, uses Geist when your app loads
  it) and a display serif for the headings (`--daymo-font-display`, uses
  Cormorant Garamond when loaded). Both fall back to the system stack — the
  stylesheet makes no third-party requests of its own.

Stable class names (the restyling surface), all prefixed `daymo-help`:
- **Shell:** `daymo-help` (root, carries `data-sidebar`), `-side`, `-brand`,
  `-mk`, `-nm`, `-new`, `-side-search`, `-lib-search`, `-side-grp-h`, `-lib`,
  `-lib-row`, `-lib-thumb`, `-lib-title`, `-lib-sub`, `-side-foot`, `-main`,
  `-topbar`, `-topbar-menu`, `-topbar-title`, `-contact`, `-scroll`, `-scrim`.
- **Home:** `-home`, `-eyebrow`, `-h1`, `-lede`, `-home-player`, `-hp-stage`,
  `-hp-video`, `-hp-overlay`, `-hp-bar`, `-hp-title`, `-hp-expand`, `-hp-rail`,
  `-hp-chip`, `-askbar`, `-lead`, `-input`, `-send`, `-suggest`, `-chip`.
- **Conversation:** `-thread`, `-qa`, `-q-bubble`, `-a-row`, `-a-av`,
  `-a-name`, `-a-tag`, `-a-text`, `-typing`, `-error`, `-clip`,
  `-clip-poster`, `-clip-kicker`, `-clip-cap`, `-clip-sub`, `-clip-cta`,
  `-steps-mirror`, `-mstep`, `-mstep-ix`, `-mstep-lb`, `-related`, `-rcard`,
  `-followups`, `-fchip`, `-a-chips`, `-a-actions`, `-act-btn`,
  `-composer-dock`, `-composer`, `-composer-input`, `-composer-send`.
- **Theater player:** `-modal`, `-player`, `-player-close`, `-player-main`,
  `-stage`, `-player-aside`, `-player-title`, `-player-desc`, `-steps`,
  `-step`, `-step-ix`, `-step-lb`, `-queue`, `-qitem`, `-autoplay`.

## The chat widget template

The embeddable widget (floating bubble → chat panel that answers with video
clips) ships as a themeable template too: every visual reads from a `--dw-*`
theme token, so it drops into any site and matches the brand. Install is one
script tag:

```html
<script async src="https://your-server.example/widget.js"
  data-widget-id="acme"
  data-theme="lume"
  data-manifest-url="/help/manifest.json"></script>
```

Script-tag attributes: `data-widget-id` (required), `data-base-url` (API
origin; defaults to the script's origin), `data-locale`, `data-theme`,
`data-manifest-url`. The last two can also come from the server via
`config.json` (`theme`, `manifestUrl`) so the embed snippet never changes.

### Shipped themes

Three themes are built in — same component, different token blocks:

- **`aurelia`** — warm editorial luxury (ivory, serif display, antique gold)
- **`lume`** — minimal mono (white, grotesk, monochrome)
- **`onyx`** — dark luxe (charcoal, gold accent)

Omit `data-theme` for the neutral default. Theme font stacks use Cormorant
Garamond / Hanken Grotesk / Schibsted Grotesk when your page loads them and
fall back to the system stack — the widget makes no font requests of its own.

### Making it match your brand

- **90% case:** set `brandColor` in the widget's `config.json` — it re-tints
  the accent and bubble of the default theme.
- **Everything else:** override tokens from your page CSS. Custom properties
  inherit through the widget's shadow root, and page rules on the host
  element beat the built-in token blocks:

  ```css
  #daymo-widget-root {
    --dw-accent: #4f46e5;
    --dw-surface: #ffffff;
    --dw-ink: #0c0c0d;
    --dw-radius: 16px;
    --dw-font: "Inter", sans-serif;
  }
  ```

Theme tokens (set any subset): geometry `--dw-panel-w`, `--dw-panel-h`,
`--dw-bubble-size`, `--dw-edge`, `--dw-radius`, `--dw-radius-sm`,
`--dw-radius-pill`, `--dw-mark-radius`; type `--dw-font`,
`--dw-font-display`, `--dw-font-mono`, `--dw-greeting-size`,
`--dw-title-weight`, `--dw-title-tracking`; color `--dw-surface`,
`--dw-surface-2`, `--dw-header-bg`, `--dw-ink`, `--dw-muted`, `--dw-border`,
`--dw-accent`, `--dw-accent-fg`, `--dw-bubble-bg`, `--dw-bubble-fg`,
`--dw-bubble-border`, `--dw-user-bg`, `--dw-user-fg`, `--dw-online`,
`--dw-error-bg`, `--dw-error-fg`, `--dw-error-border`; effects `--dw-ring`,
`--dw-ease`, `--dw-shadow`, `--dw-shadow-bubble`. The rules in
`widget/src/styles.css` never change between themes — only token values do.

### Sharing videos with the help center

If you also run the help-center page, point the widget at the same published
manifest (`data-manifest-url` or `manifestUrl` in `config.json` — same value
as the help center's `manifestUrl` option; relative URLs resolve against the
host page). `daymo publish` writes `manifest.json` next to the videos, so
both surfaces read from one place: answer cards get the help page's poster
thumbnails, and clips play from the exact same `output.mp4` files. Without a
manifest the widget falls back to the clip URLs the chat backend returns.

## Tips for AI agents authoring `.demo` files

- Prefer accessible selectors (`getByRole`, `[aria-label=...]`) over brittle `[data-testid=...]` chains when the codebase uses them.
- Mock every network call the demo will hit — Daymo runs against the real frontend, so unmocked calls will fall through to the real network.
- Keep the prose tight. Two short sentences per scene render better as captions than a long paragraph.
- Don't write assertions. Daymo isn't a test framework.
- Use `fx.step("…")` to break long scenes into named steps. One step holds one logical user action (cursor + click + say + wait).
- Hard limits per step: at most one `fx.say` and one `fx.banner`. If you'd narrate twice, split into two steps.
