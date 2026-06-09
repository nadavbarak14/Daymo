# Demo-cued answers — design

**Date:** 2026-06-09
**Status:** Approved for planning
**Scope:** Approach A — renderer + prompt + retrieval changes on the existing `ChatResponse` schema. No schema change.

## Problem

Chat answers currently interleave short text fragments with short sliced clip cards (`VideoPart` rendered as a `startMs–endMs` stub). For a linear how-to that one demo covers (e.g. "How do I import my courses from Moodle?"), this shreds a single coherent demo into 3 stubs plus a transcript dump; the user has to play each stub and reassemble the flow mentally. Observed on typenote's `/help`: the answer to the Moodle question rendered as three clip cards (0:10–0:19, 0:25–0:32, 0:47–0:52) with text wedged between — while the theater player (full video + step timeline) already renders the same demo far better.

Separately, general/meta questions (e.g. "give me ALL options of the document") get an unhelpful no-match ("couldn't understand your request"), for two reasons: a cosine-similarity threshold (<0.35) short-circuits to a canned no-match before the LLM sees the question, and the model's own `no_match` text is unguided.

## Goals

1. A video reference in an answer means **"this demo, cued at this step"** — the whole demo, scrubbable, with its step timeline — never a sliced stub.
2. The model has a **strong prior toward visual answers** ("showing beats telling") but decides per question; it may attach multiple videos (different demos) or reference multiple steps of one demo. Text-only answers remain legitimate for conceptual/meta/off-topic questions.
3. General/meta questions get real text answers grounded in the demo catalog; no-match responses are helpful, naming what *is* covered.
4. The **model drives retrieval**: it formulates the search text (query rewrite resolving conversation context), instead of the raw user message being embedded and hard-thresholded.
5. Help center and widget behave the same (decision from brainstorm: differentiate surfaces by *capability* later — e.g. in-product coachmarks — not by answer format now).

## Non-goals

- Block-document answer schema (Approach B) — deferred; this design is forward-compatible with it.
- Screenshots-in-answers, coachmark walkthroughs, per-surface intent detection, widget step timeline.
- Changing the `ChatResponse` / `VideoPart` wire schema.

## Design

### 1. Answer policy (prompt — `src/chat-server/llm.ts`, `answerSystem()`)

Rewrite the composition guidance:

- **Prior, not rule:** "Showing beats telling. When a demo covers what the user asked, attach it cued to the relevant step rather than describing UI in words ('press the button at the top' is worse than showing it). You decide per question."
- A `VideoPart` is a **cue reference**, not a clip: `startMs` = where playback starts; `startMs–endMs` = the relevant range (used for timeline highlighting). Field semantics on the wire are unchanged (`startMs`/`endMs` still must match the chunk's `globalStartMs`/`globalEndMs` — existing validation keeps working).
- Multiple video parts allowed (existing clamp: ≤3): across different demos (text bridges them), or multiple steps of the same demo (the renderer collapses these into one card with all referenced steps highlighted).
- Text-only answers are appropriate for conceptual/meta questions ("what can I do here?", "does it support X?") — grounded in the demo catalog (see §4).
- `no_match` text must be helpful: name covered topics from the catalog and suggest the nearest questions. Never a bare "rephrase that".

### 2. Help-center rendering (`src/help-center/mount.ts` — `renderResponse`, `renderVideoPart`)

- Group an answer's video parts by `demoId` → **one card per demo** (replaces N stubs).
- Card content: demo title + poster + label of the form "Full demo · 1:19 · starts at step 3/10". Duration is the demo's `durationMs` (manifest), not `endMs − startMs`.
- Click opens the **existing theater player** (`src/help-center/player.ts`, `openPlayer`) cued at the earliest referenced step's `startMs`, and **plays through to the end** — chat-originated opens do not set the one-shot `endMs` pause (that pause is the clip semantics being removed; library/timeline behavior is unchanged).
- The step timeline highlights **all referenced steps** (match by `stepId` against `ManifestDemo.steps`) so the user sees which part answers their question while keeping the whole flow scrubbable.
- No-manifest fallback (manifest not loaded): keep current behavior but cue-only — media fragment `#t=<startSec>` (open-ended, no end bound).
- Text parts render unchanged.

### 3. Widget parity (`widget/src/render-parts.ts`, `widget/src/mount.ts`, `widget/src/manifest.ts`)

- Same grouping: one card per demo.
- Lightbox cues to the earliest referenced `startMs` via open-ended media fragment (`#t=<startSec>`), and does **not** set `lightboxClipEnd` — plays through.
- Card shows demo title (from manifest via `resolveVideoSource`) and full-demo duration when the manifest is available; falls back to `part.caption` + `part.mp4Url` otherwise (existing fallback path).
- No step timeline in the widget yet (deferred; manifest already carries steps when we want it).

### 4. Model-driven retrieval (`src/chat-core/answer-chat.ts`)

- **Query rewrite step:** before retrieval, a fast LLM pass takes the conversation + current question and emits 1–2 search strings — resolving pronouns/follow-ups from context, decomposing broad questions. Each string is embedded; retrieved chunks are unioned (dedupe by chunk id) before the answer call.
- **Remove the hard threshold gate:** the <0.35 cosine short-circuit no longer bypasses the model. Weak retrieval means the answer model runs anyway with whatever chunks it has plus the catalog, and either answers from the catalog or produces a useful `no_match`. (The threshold may survive as a relevance *filter* on which chunks to include, but never as a "skip the LLM" gate.)
- **Demo catalog in context:** both the rewrite pass and the answer call get the catalog — each demo's `demoId`, `title`, `description` (from the manifest/index; small, fits trivially in the prompt). This is what makes meta questions ("what are my options?") answerable.
- Cost: one extra cheap/fast LLM call per question, against an answer call that already exists.

### 5. Validation (`src/chat-server/validate-response.ts`)

- Keep: ≤6 parts, ≥1 part, ≤3 video parts, `stepId` exists, timestamps match chunk exactly, `demoId` consistency.
- Drop: the "no two consecutive videos" rule (moot — same-demo parts collapse; different-demo cards side by side are fine).
- Allow multiple parts with the same `demoId` (they collapse client-side).

### 6. Testing

- Unit: grouping logic (parts→cards by demo, earliest-cue selection, referenced-step set); prompt fixtures for the new policy; rewrite-pass output shape; retrieval union/dedupe.
- Update: help-center mount tests (clip-card assertions → demo-card assertions), player cue tests (no `endMs` pause from chat opens), widget render-parts tests, `validate-response` tests (consecutive-videos rule removed, same-demo parts allowed).
- Existing media-fragment fallback tests adjust to open-ended `#t=`.

### 7. Consumer impact

- **typenote** `e2e/help.spec.ts` mocks `ChatResponse` and asserts on clip cards — assertions need updating when typenote upgrades daymo (same class of change as the earlier modal-player switch). Note in README/changelog.
- Wire schema unchanged, so backends/routes (`createHelpChatRoute`, widget chat handler, `mp4Url` filling) are untouched except `answer-chat.ts` retrieval flow.

## Edge cases

- Answer references steps from >3 demos: clamp keeps ≤3 video parts; prompt tells the model to pick the most relevant demos and mention the rest in text.
- `stepId` present in the answer but missing from the manifest (stale bundle): card still renders with cue from `startMs`; timeline highlight skips unknown steps.
- Empty retrieval + empty catalog (no demos published): `no_match` with the configured suggested questions, as today.
- Follow-up question where rewrite produces a context-resolved query ("how do I share *it*?" → "share a course"): covered by the rewrite pass taking conversation history.
