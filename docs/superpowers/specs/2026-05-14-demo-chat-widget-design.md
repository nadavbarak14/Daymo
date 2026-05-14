# Demo chat widget: end-user help from `.demo` artifacts

## Motivation

Daymo customers ship product demos as `.demo` files rendered to `output.mp4`. The next layer is a chat surface on the customer's product site: an end-user types "how do I do X?" and the widget answers using the customer's own demos, including a clip of the relevant moment seeked to the right step.

The widget is multi-tenant, embeds as one `<script>` tag, and renders a floating chat bubble. Answers are a sequence of interleaved text and video segments. The system refuses to answer when retrieval confidence is low — no hallucinated steps, no fabricated stepIds.

This document specifies v1: a working chat surface against artifacts stored locally on the Daymo backend. Storage to S3 + a `daymo publish` CLI + signed URLs are explicitly v2 concerns.

## Decisions and what they overrule

The brainstorm landed on a small set of decisions that the rest of the design depends on. Listing them here so reviewers can challenge the foundation without re-reading the surrounding prose.

| # | Decision | Why |
|---|---|---|
| 1 | **Multi-tenant widget on the customer's site** (not Daymo's docs, not a CLI tool) | The end-user audience is the visitor on the customer's product page, asking how to use that product |
| 2 | **Answer is a video segment seeked to the right step (with text)**, not a text-only answer or a list of search results | Aligns with the existing artifacts (output.mp4 + step timestamps); the video *is* the answer |
| 3 | **Granularity: one step (with scene fallback)** — match to `fx.step()` when present, scene otherwise | Finest sensible unit; events.json already emits step-level timestamps |
| 4 | **Naive RAG + conversation-aware query rewriting**, multi-turn chat (history capped to 2 turns) | Corpus is tiny (dozens of steps), questions are FAQ-shaped, sub-2s latency target, cheap. Search agents are 3-10× more cost/latency for no real quality win at this corpus size |
| 5 | **`gemini-embedding-001`** at $0.15/M tokens (batch $0.075/M for indexing) | MTEB leader, strongly multilingual. Gemini v2 is multimodal-only and more expensive for text |
| 6 | **Daymo SaaS proxy** runs the `POST /chat` endpoint. Customer embeds `<script>` tag with widgetId | Smallest customer-side friction; no LLM API keys exposed on the customer's frontend |
| 7 | **Floating bubble UI** with inline video in the chat thread | Familiar Intercom-style pattern; compact when collapsed; matches "show me the video" answer modality |
| 8 | **Multi-language support and mobile fullscreen are v1** | Cheap to add upfront; expensive to retrofit |
| 9 | **Storage in v1: local filesystem on Daymo backend** | Defers S3 + signed URLs without affecting widget-side contract |

## System overview

```
┌─────────────────────────────────────────────────────────────────┐
│  CUSTOMER WEBSITE                                                │
│  <script async src="https://cdn.daymo.dev/widget.js"             │
│          data-widget-id="wgt_abc123"></script>                   │
│  ────────────                                                    │
│  Shadow-DOM widget: bubble + chat panel + inline <video>        │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │ POST /chat { widgetId, message, history }
            │ POST /widget-config (first paint)
            │ GET  /widgets/<id>/demos/<demoId>/output.mp4 (range)
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  DAYMO BACKEND (one HTTP service)                                │
│                                                                  │
│   /chat ─→ [rewrite Haiku] ─→ [embed query] ─→ [cosine + BM25]   │
│            ─→ [score gate] ─→ [answer Sonnet, json_schema]       │
│            ─→ [server validate stepIds] ─→ ChatResponse          │
│                                                                  │
│   /widget-config       → name, locale, suggestedQuestions[]      │
│   /widgets/.../*.mp4   → range-served from local artifact store  │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │ Artifact store (v1 = local filesystem)                  │   │
│   │ widgets/<widgetId>/                                     │   │
│   │   config.json       allowedOrigins, locale, name        │   │
│   │   index.json        chunks + embeddings + step-index    │   │
│   │   demos/<demoId>/output.mp4, captions.vtt              │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
            ▲
            │ Indexer (one-shot per widget) reads:
            │   .demo files + per-scene events.json + stitched output.mp4
            │ and writes:
            │   index.json + step-index entries + (optionally) captions.vtt
            │
┌───────────┴──────────────────────────────────────────────────────┐
│  STITCH PIPELINE (existing, extended)                            │
│  daymo stitch ── now writes step-index.json with global ms       │
│                 and encodes mp4 with -g 30 keyframe spacing      │
└──────────────────────────────────────────────────────────────────┘
```

Three deliverable units with clean interfaces:

| Unit | Owns | Interface to outside |
|---|---|---|
| **Stitcher extension** | Global step timestamps; keyframe-friendly encode | Writes `step-index.json` alongside `output.mp4` |
| **Indexer** | Pure function: `(.demo + events.json files + step-index.json + mp4)` → `index.json` | Reads files; writes one `index.json` |
| **Chat backend** | Pure function: `(widgetId, message, history)` → `ChatResponse` | `POST /chat` HTTP endpoint |
| **Widget bundle** | UI state machine; renders `Part[]` | Talks only to `/chat` and `/widget-config`; serves video from `/widgets/.../*.mp4` |

## Timestamp contract

`StepRuntime.t` is **scene-local** (documented in `src/types.ts:86-88`), and per-scene `events.json` files are written before stitching. For the widget to seek into the *final* stitched `output.mp4`, the stitcher writes a new artifact:

### `step-index.json` (new, written by `daymo stitch`)

```jsonc
// <demo-dir>/.daymo/step-index.json
{
  "demoId": "loomly-tour",
  "mp4DurationMs": 78420,
  "scenes": [
    {
      "sceneIndex": 0,
      "globalStartMs": 0,
      "globalEndMs": 12450,
      "recordingOffsetMs": 495
    },
    {
      "sceneIndex": 1,
      "globalStartMs": 12450,
      "globalEndMs": 28100,
      "recordingOffsetMs": 380
    }
  ],
  "steps": [
    {
      "stepId": "loomly-tour:0:0",
      "sceneIndex": 0,
      "stepIndex": 0,
      "description": "(preamble)",
      "globalStartMs": 0,
      "globalEndMs": 4200
    },
    {
      "stepId": "loomly-tour:0:1",
      "sceneIndex": 0,
      "stepIndex": 1,
      "description": "Open the new-project dialog",
      "globalStartMs": 4200,
      "globalEndMs": 12450
    }
  ]
}
```

Computation, run after stitch encodes the final mp4:

```
For each scene i in order:
  trimmedDurationMs = ffprobed_duration(mixed_scene_i.webm) - recordingOffsetMs_i
  scene_i.globalStartMs = Σ_{j<i} trimmedDurationMs_j
  scene_i.globalEndMs   = scene_i.globalStartMs + trimmedDurationMs

For each step event in scene i's events.json (in t order):
  step.globalStartMs = scene_i.globalStartMs + (step.t - recordingOffsetMs_i)
  step.globalEndMs   = next step.globalStartMs in same scene
                       ?? scene_i.globalEndMs

For the implicit preamble step (stepIndex=0, no event):
  preamble.globalStartMs = scene_i.globalStartMs
  preamble.globalEndMs   = first explicit step's globalStartMs
                           ?? scene_i.globalEndMs
```

`recordingOffsetMs` is optional in the per-scene events.json (`src/types.ts:110`); treat missing as 0.

### Encoding: `-g 30` for sub-second seek precision

The current stitch ffmpeg invocation gets `-g 30` (GOP = 30 frames ≈ 0.5s at 60fps). `<video>.currentTime = startMs / 1000` then lands within 500ms of the requested moment. No other ffmpeg flag changes.

## Data model

### Per-widget `index.json` (written by indexer)

```jsonc
{
  "widgetId": "wgt_abc123",
  "embeddingModel": "gemini-embedding-001",
  "embeddingDims": 768,
  "createdAt": "2026-05-14T10:00:00Z",
  "etag": "sha256:…",                    // hash of all source artifacts
  "demos": [
    {
      "demoId": "loomly-tour",
      "title": "Loomly Tour",
      "description": "A walkthrough of the Loomly dashboard…",
      "durationMs": 78420
    }
  ],
  "chunks": [
    {
      "stepId": "loomly-tour:2:1",
      "demoId": "loomly-tour",
      "sceneIndex": 2,
      "stepIndex": 1,
      "globalStartMs": 12450,
      "globalEndMs": 18200,
      "text":     "[Demo] Loomly Tour\n[Scene] Open the new-project dialog\n[Step] Open the new-project dialog\nClick + New project to start a fresh one.",
      "embedding": [0.0123, -0.0451, /* 768 floats */],
      "keywords": ["loomly", "project", "new", "open", "dialog", "create"]
    }
  ]
}
```

Size: ~3KB per chunk (mostly the embedding). 100-step corpus = ~300KB. Loaded into backend memory on first request per widgetId, LRU-cached (~50 widgets resident at a time).

### Indexable text per step (canonical chunk shape)

```
[Demo] <demo frontmatter title>
[Scene] <scene heading>
[Step] <fx.step description, or "(preamble)" for stepIndex 0>
<all fx.say text events whose t falls in [step.t, nextStep.t), one per line>
<scene prose, only if step is the first step of the scene>
<overlay/banner text events whose t falls in [step.t, nextStep.t)>
```

**Excluded as low-signal:** `fx.click` / `page.click` / `fx.cursorTo` selectors, `fx.highlight` selectors, `fx.zoom`, `fx.pause`, `page.waitFor*`. These are mechanics. The intent text already lives in the fx.step description and surrounding fx.say.

`keywords` is a separate field used for BM25 sidecar retrieval. Computed by tokenizing the canonical text, lowercasing, deduping, removing stopwords. Cheap, no model call.

### `fx.say` bucketing to steps

`fx.say` events live at the scene level, not under a step (`src/types.ts:113`). The indexer attributes them to steps by walking events in `t` order and assigning each `say` to the most-recent `step` event (or to the implicit preamble if no step has fired yet). Same applies to `overlay` and `banner` events.

### Skipped chunks

A chunk whose canonical text contains only the `[Demo]`/`[Scene]`/`[Step]` headers and no narration/prose/overlay text is **skipped** — mechanics-only steps (e.g., a step that only calls `fx.cursorTo` and `page.click`) contribute no retrievable signal.

## Chat backend

### `POST /chat`

```ts
// Request
{
  widgetId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>; // last 2 turns max
  locale?: string;     // BCP-47, e.g. "es" or "ja"
}

// Response
type ChatResponse =
  | {
      kind: "answer";
      parts: Part[];   // 1..6 items, ≤3 video parts, no two consecutive video parts
    }
  | {
      kind: "no_match";
      text: string;
      suggestions?: string[];  // up to 3 step descriptions, clickable chips on the widget
    };

type Part = TextPart | VideoPart;

type TextPart = { kind: "text"; text: string };

type VideoPart = {
  kind: "video";
  stepId: string;
  demoId: string;
  startMs: number;
  endMs: number;
  caption: string;     // shown below the player
  mp4Url: string;      // absolute URL, constructed server-side per response.
                       // v1: `https://<daymo-backend>/widgets/<widgetId>/demos/<demoId>/output.mp4`
                       // v2: HMAC-signed S3 URL with short expiry
};
```

### Pipeline (4 sequential stages inside the endpoint)

```
1. Query rewrite (Haiku 4.5)
   Input:  history (≤2 turns) + message
   Output: self-contained search query (≤30 tokens)
   Cost:   ~$0.0001
   Time:   ~150ms

2. Retrieval
   - Embed query via gemini-embedding-001 (sync API, $0.15/M)
   - Cosine similarity vs all chunks → top-K=8
   - BM25 sidecar over `keywords` field → union with cosine top-K, re-rank
   - Compute top-1 cosine score
   Cost:   ~$0.000003 per query
   Time:   ~50ms (cosine over 100 vectors of 768 dims is microseconds; embedding API is the bottleneck)

3. Score gate (Layer 1 certainty)
   IF top-1 cosine < 0.55:
     RETURN { kind: "no_match", text: <localized fallback>, suggestions: <top-3 step descriptions by chunk popularity> }
   Cost: 0 (no LLM call)
   Time: 0

4. Answer LLM (Sonnet 4.6, structured outputs)
   Input:  system prompt + top-K chunks (with stepId, demoId, captions, text) + history + rewritten query
   Output: ChatResponse forced to schema via response_format
   Cost:   ~$0.003 per query
   Time:   ~1000ms

5. Server validation (Layer 3 certainty)
   For each VideoPart in parts:
     - stepId exists in this widget's index?
     - (globalStartMs, globalEndMs) match the index?
     - mp4Url is the canonical URL for demoId?
   Any mismatch → downgrade entire response to no_match.
   Time: <5ms
```

**Latency budget:** ~1.2s p50, ~2s p95. **Cost:** ~$0.003 per query.

### Prompts (sketches; final text in implementation)

**Query rewrite (Haiku):**

```
You rewrite the user's latest message into a single self-contained search query
that captures their full intent given prior conversation turns. Output ONLY the
query, no preamble, no quoting.

Conversation:
{history}

Latest message: {message}

Search query:
```

**Answer LLM (Sonnet) system prompt:**

```
You answer "how do I X?" questions about a product using ONLY the retrieved
demo chunks below. Your output is a JSON object matching the ChatResponse
schema.

Rules:
- If the chunks do not clearly answer the question, return kind="no_match".
  Do not use your general knowledge to fill gaps. Do not invent stepIds.
- Every VideoPart.stepId must appear verbatim in a chunk below.
- Interleave text and video parts: each video part must be preceded by a text
  part that introduces what's about to happen. No two consecutive video parts.
- Total parts ≤ 6. Video parts ≤ 3.
- Respond in the language of the user's most recent message. If ambiguous,
  use {locale}.
- For text-only answers (chunks contain explanation but no specific visual
  moment), return a single TextPart.

Retrieved chunks:
{top-K chunks rendered as labeled blocks}

Conversation history:
{history}

User: {rewritten query}
```

Structured output is enforced via Anthropic's `response_format: { type: "json_schema", schema: <ChatResponseSchema> }`. JSON schema includes `minItems: 1, maxItems: 6` for `parts`, an `oneOf` over Part variants, and `pattern` enforcement on `stepId` format.

### `GET /widget-config/<widgetId>`

Returns the per-widget configuration the widget reads on first open:

```ts
{
  name: string;                  // e.g. "Acme Helper"
  brandColor?: string;           // hex; defaults to widget default
  locale: string;                // default locale if customer didn't override
  suggestedQuestions: string[];  // up to 3, drawn from the most prominent fx.step descriptions across the demos
}
```

Suggested-question selection at index time: take all `fx.step` descriptions, dedupe, sort by chunk popularity (number of unique words across the chunk), take the top 3 phrased as questions ("How do I {description}?").

### Auth and multi-tenancy

- **Origin allowlist.** Every request to `/chat`, `/widget-config`, or any `/widgets/<id>/*` resource is rejected if `Origin` is not in the widget's `allowedOrigins` list. Stored in `config.json`. CORS preflight responds with only the allowed origin.
- **Rate limit.** 30 req/min per `(widgetId, client IP)`. 429 with `Retry-After` on excess.
- **MP4 access.** v1: the mp4 is served at `https://<daymo-backend>/widgets/<widgetId>/demos/<demoId>/output.mp4`. Origin check + widget-existence check guard it. **No signed URLs yet** — adding them is the v2 story alongside S3 migration.
- **Indexes are mutually opaque.** Each widget loads only its own index. No cross-widget retrieval ever.

### Failure modes

| Failure | HTTP | Widget renders |
|---|---|---|
| Unknown widgetId | 404 | "This help widget is not configured." |
| Origin not in allowlist | 403 + omit CORS headers | Widget self-hides; console error |
| Rate limit exceeded | 429 + `Retry-After` | "Too many questions — give me a moment." |
| Embedding upstream error | 502 | "Couldn't reach the assistant. Try again." |
| LLM upstream error | 502 | Same as above |
| Top-1 cosine < 0.55 | 200 + `{ kind: "no_match" }` | "I don't have that in the demos. Try: …" + suggestion chips |
| LLM returned invalid stepId | 200 + `{ kind: "no_match" }` (downgraded) | Same as above |
| Validation: 4+ video parts or 7+ total parts | 200 + `{ kind: "no_match" }` | Same as above |

## Widget bundle

### Boundary

One ES module bundle, ~30–50KB gzipped, served from `https://cdn.daymo.dev/widget.js`. No npm package, no React peer-dep, no theme config in v1.

Three internal units:

| Unit | Responsibility | Talks to |
|---|---|---|
| `Mount` | Read `data-widget-id`; create shadow DOM root; render bubble | DOM |
| `Chat` | State machine: `closed → open → typing → awaiting → showing-answer / error`. Holds history (in-memory). Renders `Part[]` | `Api` |
| `Api` | `POST /chat`, `GET /widget-config`. 429 backoff, 502 retry-once. Typed errors. | Daymo backend |

### Shadow DOM isolation

Widget renders inside `<div id="daymo-widget-root">` with `attachShadow({ mode: "closed" })`. Customer CSS doesn't bleed in; widget CSS doesn't leak out. Font stack on the shadow root: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

### Video element

Each `VideoPart`:

```html
<video
  preload="metadata"
  playsinline
  controls
  src="{mp4Url}#t={startMs/1000},{endMs/1000}"
>
  <track kind="captions" src="{mp4Url-with-vtt-extension}" srclang="{source-locale}">
</video>
<small class="caption">{caption}</small>
```

- `#t=` Media Fragments URI: browser fetches only the relevant byte range (with `preload="metadata"`, only the moov atom downloads until play).
- `timeupdate` listener pauses when `currentTime >= endMs/1000`. User can replay or scrub past endMs via native controls.
- Captions are an optional WebVTT file emitted by the stitcher from `fx.say` word-level timings.

### First-open UX

On first bubble click:
1. Render chat panel chrome with `{ name, brandColor, suggestedQuestions }` from `/widget-config`.
2. Show a greeting from a fixed locale-aware string ("Hi! Ask me how to do anything in {name}.").
3. Render up to 3 suggested-question chips. Clicking a chip fills the input *without* submitting; user can edit before pressing Enter.

### Multi-language

- **Widget chrome strings.** Bundled translations for `en`, `es`, `fr`, `de`, `ja`, `pt`, `zh-CN`, `it`. Auto-detect: `<html lang>` first, then `navigator.language`, fallback `en`. Override via `<script ... data-locale="es">`.
- **Answers from the LLM.** System prompt instructs the LLM to respond in the language of the user's most recent message; the customer's source demos can be in any language. Cross-language retrieval works because `gemini-embedding-001` is strongly multilingual.

### Mobile layout (viewport < 600px)

| Aspect | Desktop | Mobile |
|---|---|---|
| Bubble size | 52px | 56px |
| Open panel | 320px × ~480px, anchored bottom-right | Fullscreen `position: fixed; inset: 0` |
| Header close chrome | "−" minimize + "✕" close | "←" back arrow only |
| Video element | ~84px tall inline | Full panel width, native aspect ratio |
| Suggestion chips | Horizontal flow | Vertical stack, 44px tall |
| Input bar | Standard | Pinned to bottom with `env(safe-area-inset-bottom)` |

Detection via `window.matchMedia("(max-width: 600px)")` listened live (re-evaluates on rotation).

### History management

Last 2 turns only, in-memory in the JS module closure. No `localStorage` / `sessionStorage`. Page refresh = clean slate.

### Accessibility

- Bubble: `<button aria-label="Open product help">`, 44×44px minimum.
- Panel: `<div role="dialog" aria-modal="false" aria-labelledby="chat-title">`. Non-modal so it doesn't trap focus on the customer's page.
- Input has visible focus ring; Enter submits.
- Suggested-question chips are `<button>`s with their text as accessible name.
- Each video has a `<track kind="captions">` populated from `fx.say` word-level timings (WebVTT emitted at stitch time).
- axe-core runs against the widget in all states as part of CI.

## Indexer

### Pipeline stages

```
A. stitch (existing, extended)
   - encodes mp4 with -g 30
   - writes step-index.json alongside output.mp4

B. chunk builder (NEW)
   For each (demo, scene, step):
     - assemble canonical text from [Demo][Scene][Step] headers + fx.say + prose + overlay/banner
     - bucket fx.say/overlay/banner events into steps by t-order assignment
     - skip if assembled text contains only headers (mechanics-only step)
   Tokenize and dedupe keywords for BM25 sidecar.

C. embedder
   - Batch chunk texts via gemini-embedding-001 batch API ($0.075/M)
   - Embed in batches of 100 chunks
   - Cache by SHA-256 of chunk text — re-runs only re-embed changed chunks (out of v1 scope but artifact format supports it via the `etag` field)

D. index writer
   - Emit single index.json with chunks, embeddings, step-index merged, demo metadata
   - Idempotent: re-running on unchanged source artifacts is a no-op (etag match)
```

### Suggested-question selection

Run at index time, written into `config.json`:

```
candidates = all distinct fx.step descriptions across all demos
score(d) = unique-word-count(d) * log(1 + occurrence-count(d))
top 3 by score → phrased as "How do I {description.toLowerCase()}?"
```

### Indexer trigger

v1: invoked manually as part of setting up a new fixture customer. The CLI invocation `daymo index <demo-dir>` (new subcommand) reads the artifacts and writes `index.json` to the configured Daymo backend data root. The actual upload/publish flow (`daymo publish`) is a v2 concern.

## Storage (v1 — local filesystem)

Layout under `<daymo-backend-data-root>/`:

```
widgets/
  wgt_abc123/
    config.json         { name, brandColor?, locale, allowedOrigins[], suggestedQuestions[] }
    index.json          chunks + embeddings + merged step-index
    demos/
      loomly-tour/
        output.mp4
        captions.vtt    (optional)
      another-demo/
        output.mp4
```

Backend reads `config.json` and `index.json` into LRU memory on first request per widgetId (~50 resident, ~300KB each). MP4 served via standard range-request handler (Node has this built in via `fs.createReadStream` + `Range` header parsing).

No database in v1. New widgets are provisioned by dropping files into the right directory and triggering a backend cache invalidation (POST `/admin/reload?widgetId=…` behind an admin token).

## Testing

| Layer | What's tested | When |
|---|---|---|
| Stitcher offset math | Multi-scene concat preserves global ms; `recordingOffsetMs` trimming applied; ffprobe-measured durations match scene-end events within 50ms | every commit (real ffmpeg, tiny fixture webms) |
| Indexer (pure function) | Given fixture artifacts, produces deterministic chunks and correct stepId → (start,end)Ms map; fx.say bucketing under correct step | every commit (vitest + fixtures) |
| Retrieval recall | "Golden questions" per fixture: `(question → expected stepId)`. Run query → embed → top-K. Assert expected stepId in top-3. Recall@3 ≥ 85% | every commit (vitest, gated by `RUN_EMBED_TESTS=1` env if hitting real Gemini API) |
| Answer LLM behavior | Snapshot tests of `(question, chunks) → ChatResponse` for ~20 canned cases (single-segment, compound, refusal, text-only, locale switch) | nightly + on-demand (real Sonnet calls behind `RUN_LLM_TESTS=1`) |
| Endpoint contract | `/chat` and `/widget-config` return correct schema + status codes for happy path, 429, 502, no_match, invalid widgetId, missing origin | every commit (supertest, mocked LLM/embed) |
| Widget state machine | Open/close/typing/awaiting/error transitions; history capped to 2; Part[] rendered correctly; suggestion chips fill input | every commit (vitest + jsdom, mocked `/chat`) |
| Widget E2E | Playwright against a fixture customer site. Real question → answer renders → video element seeks within 500ms of `startMs`. Mobile viewport renders fullscreen. | nightly (Playwright headed locally) |
| Accessibility | axe-core run against widget open/closed/no_match/video-playing states | every commit |

### Golden questions per fixture

Fixture demos live under `tests/fixtures/demo-chat/`:

```
tests/fixtures/demo-chat/
  loomly-tour/
    tour.demo
    .daymo/
      step-index.json
      events.json (per scene)
    output.mp4
    golden-questions.json
```

`golden-questions.json` shape:

```jsonc
[
  { "q": "How do I create a project?",         "expectedStepId": "loomly-tour:2:1" },
  { "q": "How do I see project status?",       "expectedStepId": "loomly-tour:1:0" },
  { "q": "How do I export this thing?",        "expected": "no_match" },
  { "q": "¿Cómo creo un proyecto?",            "expectedStepId": "loomly-tour:2:1" }
]
```

## v1 MVP cut

### IN

- `daymo stitch` extension: writes `step-index.json`; encodes mp4 with `-g 30`.
- `daymo index <demo-dir> --widget-id <id>` CLI: builds `index.json` + writes it to the configured backend data root.
- Chat backend: `POST /chat`, `GET /widget-config`, mp4 range serving from local filesystem.
- Three-stage chat pipeline (rewrite → retrieve → answer) with Layer-1 score gate and Layer-3 stepId validation.
- Widget bundle: floating bubble, chat panel with interleaved Part rendering, inline `<video>` with byte-range loading, suggestion chips, mobile fullscreen, 8 locales.
- Multi-tenancy: per-widget `config.json` with `allowedOrigins` enforcement and rate limit.
- Test layers as listed above.

### OUT (v2 or later)

- `daymo publish` CLI for uploading artifacts to a SaaS endpoint
- Customer dashboard (manage widgets, view query logs, rotate widgetIds)
- S3 storage + HMAC-signed mp4 URLs
- Per-customer tunable cosine threshold + near-miss query logs
- Pre-cut per-step clips (keyframe spacing handles seek precision for v1)
- Custom theming / brand colors beyond a single `brandColor` field
- Streaming responses (currently the full ChatResponse returns at once)
- Voice input, conversation export, share-this-answer permalinks
- Localized subtitle tracks per locale (v1 ships source-language captions only)
- iframe embed / npm package / React component variants
- Authenticated end-users (v1 is anonymous; rate-limit only)

### Definition of done

A new fixture customer can:

1. Have their artifacts (.demo + output.mp4 + per-scene events.json) processed by `daymo stitch` (with the v1 extensions) and `daymo index`, dropped into `<data-root>/widgets/<id>/` on the Daymo backend.
2. Be assigned a `widgetId` with an `allowedOrigins` list via a `config.json` file.
3. Embed `<script async src="…/widget.js" data-widget-id="X">` on a test page.
4. Ask any golden question for their demo set in English, Spanish, or Japanese on desktop or mobile.
5. Receive a correctly-rendered ChatResponse: either a `kind: "answer"` with interleaved text + video segments (each video seeks within 500ms of the expected step start), or an honest `kind: "no_match"` with suggestion chips.

When all five work end-to-end against ≥3 fixture demos, v1 ships.

## Open questions for implementation

These are explicit unknowns that need a decision during the plan-writing or implementation phase, not now:

1. **Server runtime.** Node (consistent with existing Daymo tooling) is the obvious choice but a thin Hono / Fastify layer vs raw `http.createServer` is a real decision.
2. **Backend data root location.** A configurable env var, but defaults need a sensible value on dev machines vs deployment targets.
3. **Embedding API key management.** Whether the backend reads `GEMINI_API_KEY` from env (probably yes) and how that interacts with the test layers that gate on `RUN_EMBED_TESTS=1`.
4. **WebVTT generation.** Whether the stitcher writes captions.vtt by default or only on a flag. Defaulting to on adds a few ms to stitch and is the right shape for accessibility, but the existing pipeline doesn't emit it today.

None of these change the architecture. They're tactical choices the plan will pin.
