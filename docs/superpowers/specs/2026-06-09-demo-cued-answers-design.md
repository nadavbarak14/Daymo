# Demo-cued answers — design

**Date:** 2026-06-09 (rev 2 after adversarial review)
**Status:** Approved for planning
**Scope:** Approach A — renderer + prompt + retrieval changes on the existing `ChatResponse` schema. No wire-schema change.

## Problem

Chat answers currently interleave short text fragments with short sliced clip cards (`VideoPart` rendered as a `startMs–endMs` stub). For a linear how-to that one demo covers (e.g. "How do I import my courses from Moodle?"), this shreds a single coherent demo into 3 stubs plus a transcript dump; the user has to play each stub and reassemble the flow mentally. Observed on typenote's `/help`: the answer to the Moodle question rendered as three clip cards (0:10–0:19, 0:25–0:32, 0:47–0:52) with text wedged between — while the theater player (full video + step timeline) already renders the same demo far better.

Separately, general/meta questions (e.g. "give me ALL options of the document") get an unhelpful no-match, because a cosine-similarity threshold (<0.35, `answer-chat.ts:42`) short-circuits to a canned no-match before the LLM sees the question.

## Goals

1. A video reference in an answer means **"this demo, cued at this step"** — the whole demo, scrubbable, with its step timeline — never a sliced stub.
2. The model has a **strong prior toward visual answers** ("showing beats telling") but decides per question; it may attach multiple videos (different demos) or reference multiple steps of one demo. Text-only answers remain legitimate for conceptual/meta/off-topic questions.
3. General/meta questions get real answers grounded in the demo catalog — with video cards where possible, since showing beats telling there too. No-match responses are helpful, naming what *is* covered.
4. The **model drives retrieval**: the existing query-rewrite pass becomes always-on and multi-query; the rewrite output is retrieval-only; the hard threshold stops gating the LLM.
5. **Dual-goal surfaces, one format:** both surfaces render the same answer format (cards + text). The help center leans "demo what this product can do" (prospects); the widget leans "how do I do X" (mid-task users). The lean is expressed only in *playback affordance* (§2/§3), not in answer composition.

## Non-goals

- Block-document answer schema (Approach B) — deferred; this design is forward-compatible with it.
- Screenshots-in-answers, coachmark walkthroughs, per-surface intent detection, widget step timeline.
- Changing the `ChatResponse` / `VideoPart` wire schema.
- Streaming answers (UI stays typing-dots-until-JSON).

## Design

### 1. Answer policy (prompt — `src/chat-server/llm.ts`, `answerSystem()`)

Rewrite the composition guidance:

- **Prior, not rule:** "Showing beats telling. When a demo covers what the user asked, attach it cued to the relevant step rather than describing UI in words ('press the button at the top' is worse than showing it). You decide per question."
- A `VideoPart` is a **cue reference**, not a clip: `startMs` = where playback starts; `startMs–endMs` = the relevant range (timeline highlighting + widget soft-stop). Wire semantics unchanged (`startMs`/`endMs` still must match the chunk's `globalStartMs`/`globalEndMs`; existing validation keeps working). Per-part `caption` remains meaningful: it becomes the referenced-step sub-line on the collapsed card, so the model still writes step-level "what you'll see" captions.
- Multiple video parts allowed (≤3): across different demos (text bridges them), or multiple steps of the same demo (renderer collapses into one card, all referenced steps highlighted).
- If more than 3 demos are relevant: cite the 3 most relevant as video parts and mention the rest **in text placed before the final video part** (see §5 clamp change — trailing text is preserved either way, but front-loading is the instruction).
- Text-only answers are appropriate for conceptual questions — but for catalog-level questions ("what can I do here?") the model should still attach representative demo cards (§4 makes the chunks available).
- **Catalog grounding rule:** capability claims may only assert what a demo title/description or retrieved chunk actually states. When retrieval is weak (the prompt receives a `retrievalConfidence: low` signal derived from the old threshold), prefer catalog-level answers or `no_match` — never a confident unsupported "yes it supports X". This surface is public and prospect-facing; a wrong capability claim is the worst failure mode.
- `no_match` text must name covered topics from the catalog and suggest the nearest questions. Never a bare "rephrase that".
- **Language:** the answer call receives the user's **original message** (not the rewritten search strings), so the existing detect-language-from-their-words rule works for non-English users (fixes a latent bug where follow-ups were answered against the English rewrite).

### 2. Help-center rendering (`src/help-center/mount.ts`, `src/help-center/player.ts`)

- Group an answer's video parts by `demoId` → **one card per demo**, rendered at the position of that demo's *first* video part (text parts stay interleaved around it).
- Card content: demo title + poster + "Full demo · 1:19 · starts at step 3/10" (duration = manifest `durationMs`) + the referenced steps as sub-lines using each part's `caption`.
- Click opens the **theater player** cued at the earliest referenced step's `startMs` and **plays through to the end** (prospect lean: more product exposure is the point). Chat-originated opens never set an end-stop.
- **Player API:** `PlayerCue` gains `referencedStepIds?: string[]`. The step timeline renders those steps in a new persistent `referenced` visual state, distinct from (and composable with) the playhead-following `active` state.
- `stepsMirror` (the full step list currently rendered under the answer) is **removed** — superseded by the card + in-player highlighted timeline.
- `clipEndMs` one-shot-pause plumbing in `player.ts` becomes dead code → removed (nothing sets `endMs` cues after this change).
- No-manifest fallback: cue-only open-ended media fragment `#t=<startSec>`.
- Text parts render unchanged. The existing related-playlist under answers stays.

### 3. Widget rendering (`widget/src/render-parts.ts`, `widget/src/mount.ts`, `widget/src/manifest.ts`)

- Same grouping and card format as §2 (one card per demo, title + poster + duration + starts-at label; captions as sub-lines).
- **Playback (how-do-I lean):** lightbox cues to the earliest referenced `startMs` and takes a **one-shot soft pause at the end of the referenced range** (last referenced part's `endMs`): pause once, show a "Keep watching" affordance, and clear the stop on any user interaction (play/seek). This replaces today's *sticky* `lightboxClipEnd` (never cleared — re-pauses on every subsequent play; a real bug) with the help-center one-shot semantics, and preserves the mid-task user's "you're done" signal that play-through would otherwise remove.
- Widget manifest parser extends its `ManifestDemo` subset with `durationMs` (and optionally `steps` for future use); `VideoSource` gains `durationMs`. (The published manifest already carries these; only the widget-side types/parser lack them.)
- No step timeline in the widget yet (deferred).

### 4. Model-driven retrieval (`src/chat-core/answer-chat.ts`, `src/chat-server/llm.ts`)

Current state (for accuracy): `rewriteQuery` already exists (`llm.ts:13-38`) and runs on follow-up turns only; first-turn messages embed raw; a single rewritten string both retrieves *and* replaces the user's message in the answer call.

Changes:

- **Always-on multi-query rewrite:** the rewrite pass takes conversation + question + **demo catalog** and emits 1–2 search strings (resolving pronouns/follow-ups, decomposing broad questions). It also flags **catalog-level intent** ("what are my options?"-shaped questions).
- **Retrieval:** embed each rewrite string; in parallel, embed the original message (latency mitigation — the answer call waits for the union, so added first-turn latency ≈ the rewrite call, not rewrite + serial embeds). Retrieve k=8 per embedding; merge by max cosine per chunk; dedupe by `stepId`; cut to 8 total. `topCosine` analytics = max across queries (event shape: `rewrittenQuery` becomes `rewrittenQueries: string[]`; `RewriteQueryFn` signature changes accordingly).
- **Catalog-level intent path:** when flagged, additionally retrieve each catalog demo's first-step chunk so the answer model can legitimately cite representative `stepId`s as cards (validation requires stepIds to come from chunks — without this, meta answers would be forced text-only, defeating goal 3 in a show-don't-tell product).
- **Threshold becomes a signal, not a gate:** the <0.35 short-circuit is removed; instead the answer prompt receives `retrievalConfidence: low|normal` (and §1's grounding rule governs behavior). `topCosineScore` analytics emission is kept so regressions stay visible.
- **Rewrite output is retrieval-only.** The answer call's `query` is the user's original message (§1 language fix).
- **Empty everything:** retrieval empty *and* catalog empty (no demos published) → server-side canned `no_match` with configured suggested questions, no LLM call (explicit branch replacing what the gate used to produce via `topCosineScore: 0`).
- **Abuse posture:** the endpoint is public; gate removal means garbage messages now cost rewrite + answer calls instead of one embedding. We rely on the existing rate limiting (`src/chat-server/rate-limit.ts`). Prompt-injection stays contained: video fields are server-pinned from the index and all text renders via `textContent`.
- Cost: one extra fast LLM call per question. Latency: bounded by the parallel-embed arrangement above; acceptable against the existing answer call. If first-turn latency proves noticeable, the fallback lever is skipping rewrite on turn 1 unless the question is broad/meta — noted, not designed.

### 5. Validation & server (`src/chat-server/validate-response.ts`, `llm.ts`)

- Keep: ≤6 parts, ≥1 part, ≤3 video parts, `stepId` exists, timestamps match chunk exactly, `demoId` consistency.
- Drop: the "no two consecutive videos" rule (moot — same-demo parts collapse; different-demo cards side by side are fine).
- Allow multiple parts with the same `demoId` (collapse is client-side).
- **`clampParts` fix (`llm.ts:77-85`):** currently truncates at the 3rd video part *and drops all trailing parts including text* — which would silently delete the "other relevant demos" text from §1's >3-demos instruction. Change it to drop only excess *video* parts and preserve text parts.

### 6. Strings / i18n

- New help-center strings: full-demo card labels ("Full demo", "starts at step {n}/{m}", referenced-step kicker). Obsolete: `clipKicker`, `clipCuedLabel`, `stepsInClip` (and the steps-mirror strings) — removed from `HelpCenterStrings`.
- Widget: same new labels + "Keep watching" across the 8 locale files in `widget/src/locales/`.
- The two surviving canned fallbacks — the validation-failure path's no-match (`answer-chat.ts:74-77`) and `llm.ts`'s "I couldn't construct an answer" — route through configurable strings instead of hardcoded English (they are the escape hatch for goal 3 and must not stay unlocalized/unhelpful).

### 7. Testing

- Unit: grouping logic (parts→cards by demo, card position = first part, earliest-cue selection, referenced-step set, caption sub-lines); `clampParts` preserves text; multi-query retrieval merge/dedupe/topCosine; catalog-intent path injects first-step chunks; prompt fixtures for the new policy + grounding rule; rewrite output shape (`string[]` + intent flag).
- Help center: mount tests (clip-card → demo-card assertions, stepsMirror removed), player tests (`referencedStepIds` highlight state; no end-stop from chat opens; `clipEndMs` removed).
- Widget: render-parts tests (grouped card), lightbox one-shot soft pause (pauses once at referenced end, "Keep watching" shown, cleared on interaction — regression test for the old sticky-pause bug), manifest parser `durationMs`.
- `validate-response` tests: consecutive-videos rule removed, same-demo parts allowed.
- Media-fragment fallback tests adjust to open-ended `#t=`.

### 8. Consumer impact

- **typenote** `e2e/help.spec.ts` mocks `ChatResponse` and asserts on clip cards — assertions need updating when typenote upgrades daymo (same class of change as the earlier modal-player switch). Note in README/changelog.
- Wire schema unchanged; backends/routes (`createHelpChatRoute`, widget chat handler, `mp4Url` filling) untouched except the `answer-chat.ts` retrieval flow and the event-shape change (`rewrittenQueries`).

## Edge cases

- Answer references steps from >3 demos: prompt instructs top-3 as cards + the rest named in text; `clampParts` (fixed) preserves that text even if the model overflows.
- `stepId` in the answer but missing from the manifest (stale bundle): card still renders, cued from `startMs`; timeline highlight skips unknown steps.
- No demos published: server-side canned `no_match` with configured suggestions (explicit branch, §4).
- Follow-up with pronouns ("how do I share *it*?"): rewrite resolves from conversation history; answer call still sees the original message for language/tone.
- Non-English question: answered in the user's language (original message reaches the answer call — §1).

## Review-driven decisions (rationale log)

- **Widget soft-stop vs play-through:** adversarial review showed play-through + no step timeline would leave the mid-task widget user with zero end-of-relevance signal, while the existing hard stop is a sticky-pause bug. Resolution: same *format* both surfaces, divergent *playback affordance* — help center plays through (demo lean), widget one-shot soft-pauses at the referenced range's end (how-to lean). This is capability-level divergence, consistent with the surfaces decision.
- **Meta answers get cards:** validation pins stepIds to chunks, so catalog-only context would force text-only meta answers; the catalog-intent retrieval path (first-step chunk per demo) restores show-don't-tell.
- **Gate removal hallucination risk:** mitigated by the catalog-grounding prompt rule + `retrievalConfidence` signal + retained analytics, not by keeping the gate.
