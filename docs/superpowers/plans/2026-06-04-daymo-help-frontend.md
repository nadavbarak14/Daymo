# Daymo Self-Hosted Help — Frontend Plan (Plan A3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `<HelpCenter>` surface — a YouTube-style gallery rendered from `manifest.json` plus a chat box that POSTs to the consumer's `/api/help/chat` and renders text + inline video clips.

**Architecture:** A pure `buildGalleryModel(manifest)` + a framework-agnostic vanilla `mountHelpCenter(container, opts)` (the substance, jsdom-tested). A thin React `<HelpCenter>` wrapper mounts the vanilla UI in `useEffect`; React is an **optional peer dependency** (the component is the only React-touching code). No embeddings ever reach the browser — the gallery reads `manifest.json`, not `index.json`.

**Tech Stack:** TypeScript (ESM), vitest + jsdom, React 19 (peer/dev only, for the wrapper).

**Spec:** `docs/superpowers/specs/2026-06-04-daymo-self-hosted-help-integration-design.md`

## File structure
- Create: `src/help-center/gallery-model.ts` — `buildGalleryModel`, `formatDuration` (pure).
- Create: `src/help-center/mount.ts` — `mountHelpCenter(container, opts)` → unmount fn (vanilla DOM gallery + chat).
- Create: `src/react/help-center.tsx` + `src/react/index.ts` — `<HelpCenter>` wrapper.
- Modify: `tsconfig.json` — `"jsx": "react-jsx"`.
- Modify: `package.json` — `./react` + `./help-center` exports; `react` optional peer; `react`/`@types/react` devDeps.
- Tests: `tests/unit/help-center/gallery-model.test.ts`, `tests/unit/help-center/mount.test.ts` (jsdom).

## Task 1: Gallery model (pure)
- [ ] Test: `formatDuration(90000) === "1:30"`; `buildGalleryModel` maps manifest demos to cards (durationLabel, stepCount, videoUrl).
- [ ] Implement `gallery-model.ts`. Run → PASS. Commit.

## Task 2: Vanilla mount (gallery + chat)
- [ ] Test (`// @vitest-environment jsdom`, injected `fetchImpl`): mount renders the title + a card per demo (`[data-demo-id]`); submitting the chat form POSTs to `chatEndpoint` and renders the assistant text + a `<video>` whose `src` carries `#t=start,end`; `unmount()` removes the UI.
- [ ] Implement `mount.ts`. Run → PASS. Commit.

## Task 3: React wrapper + exports
- [ ] Add `react`/`@types/react` devDeps + `react` optional peer; `"jsx": "react-jsx"`; `./react` + `./help-center` exports.
- [ ] Implement `src/react/help-center.tsx` (mounts vanilla in `useEffect`, returns unmount as cleanup) + `src/react/index.ts`.
- [ ] Build (`npx tsc`) and verify `dist/react/index.js` exports `HelpCenter` and `dist/help-center/mount.js` exports `mountHelpCenter`.
- [ ] Commit.

## Self-review
- Gallery reads `manifest.json` only — no embeddings client-side (Decision #10).
- Vanilla mount is the tested substance; React wrapper is a thin, optional-peer convenience (consistent with the repo's existing vanilla `widget/`).
- Video parts use media-fragment `#t=start,end` (matches the existing widget playback).
