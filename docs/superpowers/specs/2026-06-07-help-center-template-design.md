# Help Center Template — design

**Date:** 2026-06-07
**Source:** Claude Design handoff bundle (`help/Responsive preview.html` → `help/index.html` + `help-app.js` + `help-data.js`), user-approved scope.

## Goal

Make the designed "generic Daymo help page" the template Daymo ships, so any
project gets the full page with two lines:

```tsx
import "daymo/help-center.css";
<HelpCenter manifestUrl="/help/index.json" chatEndpoint="/api/help/chat" />
```

There are no existing consumers to stay compatible with; optimize for easy
reuse, not migration.

## Approach (chosen: A)

Rewrite the existing framework-agnostic vanilla mount
(`src/help-center/mount.ts`) and replace the default stylesheet
(`styles/help-center.css`) with the design's visual system. The React
`<HelpCenter>` wrapper stays a thin pass-through. Rejected: scaffolded
copy-paste template files (forks, no upgrades) and a React-first rewrite
(breaks framework-agnostic mount).

## Options (`HelpCenterOptions`)

| option | required | default | purpose |
|---|---|---|---|
| `manifestUrl` | yes | — | published `HelpManifest` JSON |
| `chatEndpoint` | yes | — | POST `{message, history}` → `ChatResponse` |
| `name` | no | `"Help"` only (no product name) | appbar brand: "Acme *Help*". The mount never touches `document.title` — the host page owns it |
| `title` | no | `"How can we help?"` | hero heading |
| `brandColor` | no | `#6355c0` | sets `--daymo-accent`; every tint derives via `color-mix` |
| `logoUrl` | no | built-in play-glyph SVG | appbar/footer mark image |
| `suggestedQuestions` | no | `[]` (row hidden) | "Popular:" chips under the ask bar; also reused by no-match answers |
| `contactHref` | no | unset (hidden) | appbar Contact button + footer "Contact support" link |
| `chrome` | no | `true` | `false` drops appbar, footer **and the mobile FAB** for hosts with their own layout |
| `strings` | no | design copy | `Partial<HelpCenterStrings>` — every visible string (lede, ask placeholder, eyebrow, gallery heading/sub, popular label, nav labels, FAB label, assistant tag, steps heading, error text, footer labels). Closes brand-voice + i18n without forking |
| `fetchImpl` | no | global fetch | test injection (existing) |

`name` default rendering: when unset, the brand text is just "Help" as the
primary label (the ≤380px rule that hides the "Help" suffix only applies when
`name` is present, so the brand never renders empty).

`logoUrl` replaces the appbar mark **and the assistant avatar**; the footer
"Built with Daymo" badge always uses the Daymo glyph (supported removal path:
`.daymo-help-built { display: none }`).

Suggestions precedence in no-match answers: render `resp.suggestions` when the
server provides them, else fall back to the `suggestedQuestions` option.

## Page structure (full-page default)

Matches the design's markup, all classes `daymo-help-*`:

1. **Appbar** — sticky, blurred (`backdrop-filter`), brand mark + "{name} Help",
   nav: "Browse videos" (scroll jump) / "Ask" (scroll top + focus input) /
   Contact (only when `contactHref`).
2. **Hero / ask** — dot-grid background fading down, "Help Center" eyebrow,
   h1 (`title`), fixed lede copy, ask bar (search icon, input, Ask button —
   icon-only ≤640px), suggestion chips.
3. **Answer thread** — per Q&A: right-aligned accent question bubble; assistant
   row with avatar, "Assistant · DAYMO" tag, typing dots while the fetch is in
   flight, then the answer:
   - `text` parts → paragraphs (textContent, no HTML injection)
   - `video` parts → **clip citation card**: poster thumbnail + caption +
     "{demo title} · m:ss–m:ss". Demo metadata is looked up by `demoId` in the
     loaded manifest; if unavailable, fall back to an inline
     `<video src="…#t=s,e" controls>` like today.
   - `no_match` → text + suggestion chips that re-ask on click.
   - fetch error → `.daymo-help-error` line (existing behavior).
   - history: the request's `history` contains only turns *prior* to the
     current message (push the user turn after building the request body —
     fixes the current double-send of the question in `message` + `history`),
     truncated to the last 2 turns.
   - the thread is an `aria-live="polite"` region so answers (and the typing
     indicator's replacement) are announced.
4. **Video guides gallery** — section head ("Video guides" + sub), 3-col grid
   (2-col ≤900px, 1-col ≤640px). Card: a real `<button>` (keyboard-operable)
   containing the poster `<img>` with hover-scaling play overlay + mono
   duration badge, title, description, footer "m:ss · N steps". Click →
   player modal. No category filters (cut). When the manifest fails to load
   or has zero demos, the whole gallery section and its nav/footer jump links
   are hidden (no orphaned heading).
5. **Footer** — "All videos" jump + optional "Contact support", right-aligned
   "Built with **Daymo**" mark. Hidden with `chrome:false` (appbar too).
6. **Mobile ask FAB** — fixed "Ask a question" pill ≤640px; scrolls to top and
   focuses the input.

## Player modal

The design's simulated stage becomes a real player:

- Modal (`role="dialog"`, `aria-modal`) with header (title + close), real
  `<video controls>` using the demo's `videoUrl` + `posterUrl`, and a steps
  panel listing manifest steps (`m:ss` + label); right sidebar on desktop,
  below the video ≤900px, full-screen sheet ≤640px.
- Step click → `video.currentTime = startMs/1000`, keeps playing state.
- Active step tracks `timeupdate` (last step whose `startMs` ≤ current time).
- Clip-card open: cue to `startMs`, autoplay, one-shot pause at `endMs`.
  The pause is cleared on *user* seeks/step clicks only — programmatic cue
  seeks are flagged so the initial `currentTime` assignment doesn't clear it.
- Close: button, backdrop click, Escape — and closing **pauses the video**.
  Body scroll locked while open.
- Focus management: focus moves to the close button on open, Tab is trapped
  inside the dialog, and focus is restored to the opener on close.
- The modal element is appended to `document.body` (escapes host stacking
  contexts when embedded) and removed on unmount. Z-indices are tokens
  (`--daymo-z-modal`, `--daymo-z-fab`).
- No custom scrubber/cursor choreography — native video controls (the
  prototype simulated video; we have the real thing).

## Stylesheet (`styles/help-center.css`)

Full design CSS, adapted:

- Tokens renamed to `--daymo-*` (`--daymo-accent`, **`--daymo-accent-ink`**
  (text on accent surfaces — *not* derivable from an arbitrary brand color;
  light brands need to override it, documented in the README), `--daymo-bg`,
  `--daymo-fg`, `--daymo-border`, radii, shadows, z-indices…), declared on
  `.daymo-help` so they're overridable per-host. Accent tints derive with
  `color-mix(in srgb, …)`.
- Dark theme: `[data-daymo-theme="dark"] .daymo-help` (and
  `.daymo-help[data-daymo-theme="dark"]`) variable overrides, per the design's
  dark palette.
- Font: **no third-party `@import`** (GDPR/offline/render-blocking liability
  in a default skeleton). Ship the design's metrics on a system stack
  (`'Geist', ui-sans-serif, system-ui, …` so Geist is used if the host loads
  it); "add your brand font" is the first documented copy-and-own
  customization.
- Breakpoints exactly as designed: 900px (gallery 2-col, player stacks),
  640px (single column, icon-only Ask, FAB, full-screen player), 380px
  (brand "Help" suffix hidden).
- Selection tint, sticky-bar blur, hover lift on cards, `prefers-reduced-motion`
  guard on the thread rise animation — all kept from the design.

## Customization story (agent-friendly by design)

Consumers have coding agents; the template leans on that instead of growing
option knobs:

- **Behavior lives in Daymo** (mount, chat, player, manifest wiring) — never
  forked, upgraded via the package.
- **Looks live entirely in the stylesheet**: stable `daymo-help-*` class names
  on every element and `--daymo-*` custom properties for all colors/radii/
  shadows/spacing. A project either imports `daymo/help-center.css` as-is,
  overrides a few vars, or **copies the file into its repo and owns it** — an
  agent can restyle it to match the host site with zero functional risk.
- Options exist only for content CSS can't express (brand name, logo, chat
  endpoint, suggested questions…). No layout/variant options.
- README gains a "Making it match your product" section: set `brandColor` for
  90% of cases (plus `--daymo-accent-ink` for light brand colors); copy the
  stylesheet and let your coding agent restyle for the rest. It includes a
  **class-name inventory** — that's the agent's API surface for copy-and-own
  restyling — and markup/class changes are semver-meaningful.

**Mount hygiene** (the design prototype's global wiring must not survive):

- No `id` attributes, no `document.querySelector` — all element refs scoped to
  the mount root (as today). Multiple mounts must coexist.
- `brandColor` sets `--daymo-accent` inline on the root element, never `:root`.
- Unmount removes every document/body-level side effect: the Escape keydown
  listener, the body scroll lock, and the body-appended modal — safe under
  React 18 StrictMode double-mount and when unmounted with the modal open.

## Files touched

- `src/help-center/mount.ts` — rewrite render (same exported signature shape,
  options extended).
- `src/help-center/gallery-model.ts` — unchanged (reuse `formatDuration`,
  `buildGalleryModel`).
- `src/react/help-center.tsx` — remount when options change, keyed by
  `JSON.stringify` of the serializable options (`fetchImpl` excluded).
  Documented caveat: a remount discards the chat thread.
- `styles/help-center.css` — replaced.
- `README.md` — refresh the help-center usage snippet/screenshot wording.

## Testing

Update/extend the existing vitest suites (happy-dom):

- mount renders appbar/hero/gallery/footer; `chrome:false` removes
  appbar+footer+FAB; options wire through (brand name, `title`, accent var,
  `logoUrl` on appbar mark + avatar, chips, contact visibility, `strings`
  overrides).
- gallery renders cards (as `<button>`s) from a manifest fixture; card click
  opens the modal with that demo's video and steps; empty/failed manifest
  hides the gallery section.
- step click seeks; clip card cues `startMs` and sets up `endMs` pause; the
  programmatic cue seek does NOT clear the pause, a user seek does
  (timeupdate/seek events dispatched in test); close pauses the video and
  restores focus.
- chat: typing indicator appears then is replaced; text/video/no-match/error
  paths; no-match chips re-ask; server `resp.suggestions` win over the option;
  `history` excludes the current message and truncates to last 2.
- unmount cleanup: keydown listener, scroll lock, and body-appended modal all
  removed (StrictMode-style mount→unmount→mount leaves no residue).
- note: happy-dom's `<video>` lacks real `play()`/`currentTime` semantics —
  the suite stubs them.

## Out of scope

Category filters, feedback (helpful/not-quite) buttons, toast, the prototype's
Tweaks panel, simulated cursor/highlight choreography, KaTeX. Also explicitly
deferred (decisions, not omissions): container-query breakpoints (breakpoints
are viewport `@media`, so a narrow embedded container in a wide window gets
the desktop layout), Android back-button closing the full-screen mobile
player, and auto-contrast for `--daymo-accent-ink`.

Note: the wire format the mount POSTs (`{message, history}`) matches
`createHelpChatRoute`'s contract, not the legacy `ChatRequest` type (which
requires `widgetId`); aligning that type is pre-existing drift, out of scope
here.
