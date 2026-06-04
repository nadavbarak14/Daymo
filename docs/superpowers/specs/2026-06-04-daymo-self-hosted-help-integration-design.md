# Daymo as a product: self-hosted `/help` integration

## Motivation

Daymo already turns `.demo` files into narrated tutorial videos and, via the demo-chat-widget
(`docs/superpowers/specs/2026-05-14-demo-chat-widget-design.md`), can answer "how do I X?" with
text + video clips seeked to the right step. That widget was specified as a **Daymo-hosted,
multi-tenant SaaS**.

This document re-frames Daymo as a **product that other applications integrate and self-host**.
The first consumer is **typenote** (Next.js 16 / React 19 on Vercel, Supabase, PostHog, Vercel AI
SDK with `@ai-sdk/google`), but nothing here is typenote-specific.

The deliverable for a consumer is a **public, unauthenticated `/help` page**: a YouTube-style
gallery of manual videos plus a chat box that answers "how do I X?" with text + inline video
clips. The consumer owns the AI key, the compute, and the video bucket. Daymo ships the CLI, the
page UI, the route logic, and a provider-agnostic observability hook.

This is the **self-hosted tier** (v1). A future "managed" tier (Daymo runs `/chat` and holds the
key) is explicitly out of scope here.

## Decisions and what they overrule

| # | Decision | Why |
|---|---|---|
| 1 | **Self-hosted, single-tenant.** The consumer runs `/chat` on their own compute; the multi-tenant `widgetId` / `allowedOrigins` machinery collapses to one fixed config. | The consumer wanted to own the key, cost, and data. The current `widgetId`-keyed handlers are dead weight for one consumer. |
| 2 | **CI-first, config-driven integration.** A `daymo.config.json` + one CI command (`npx daymo publish`) + two small files in the consumer app. | "Daymo is a product." The integration must be identical across consumers, not framework-specific glue. |
| 3 | **Providers via the Vercel AI SDK; consumer brings the key.** The LLM is already on the AI SDK (`src/chat-server/llm.ts`); only the embedder is ported. Key/model passed as parameters. | Any provider, any key. typenote reuses its existing `GOOGLE_GENERATIVE_AI_API_KEY`. Daymo holds nothing. |
| 4 | **Daymo pins its own embedding model (default `gemini-embedding-001`, Google).** It is recorded in the index and validated **by model-identity string** at query time. | The index-time and query-time embedding models must be the *same model*. Differing **dimensions** are already caught (`cosine.ts:2` throws on length mismatch); the undetected failure is **same-dims, different model** (e.g. a future same-dim revision), which silently corrupts retrieval — so the guard compares the model string, not just dims. Daymo-internal invariant; unrelated to the consumer's own embedding pipeline (typenote's `gemini-embedding-2-preview` for its product features never touches this). |
| 5 | **Rendering runs in a dedicated CI job (Chromium + ffmpeg), separate from the Vercel build.** `daymo publish` stays the light step (index + upload). Demos are **self-contained**: every browser response is mocked **inside the `.demo`** (no new Daymo primitive). | A manual render is an e2e run; it belongs in a CI job with a browser, not in `vercel build` (no browser, time limits). In-file mocks make the render hermetic. Hash-caching skips unchanged demos. |
| 6 | **Videos in a public S3-compatible bucket (Cloudflare R2 recommended).** Served directly to the browser via media-fragment URLs; version-namespaced paths. | Zero egress for video; the consumer's server never streams bytes. A public help page's videos are public anyway. |
| 7 | **The page ships as `daymo/react` `<HelpCenter>` (config via props), plus a vanilla script-tag build.** | typenote is React; the script build keeps non-React consumers unblocked. The gallery is net-new UI generated from `index.json`. |
| 8 | **Observability is provider-agnostic via an `onEvent` hook. In v1 the default/only built-in sink is a generic webhook.** Never PostHog-dependent. | A product can't require every consumer to run PostHog. The webhook lets a consumer route events anywhere (typenote → PostHog). The **Daymo-hosted collector + "top unanswered questions" dashboard is its own backend product, deferred to v2** (its API/auth/retention are undecided — see Scope). |
| 9 | **The runtime index is bundled with the deploy and loaded per cold start.** No vector DB in v1. | At help-center corpus size (dozens–hundreds of steps) an in-memory cosine scan is microseconds. Stated as an explicit scale limit. |
| 10 | **The browser never receives the embedded `index.json`.** A separate `demos`-only manifest feeds the gallery. | The full index carries every chunk's 768-float embedding (`types.ts:200`); shipping it client-side is large and leaks the index. The gallery only needs titles/durations/thumbnails. |

## System overview (self-hosted)

```
┌──────────────────────── CONSUMER APP (e.g. typenote, Next.js/Vercel) ──────────────────────┐
│                                                                                            │
│  app/help/page.tsx            →  <HelpCenter indexUrl chatEndpoint theme locale layout />  │
│     (renders daymo/react: gallery from manifest.json + chat box)                           │
│                                                                                            │
│  app/api/help/chat/route.ts   →  export const POST = createChatRoute({                     │
│     (daymo/next factory)              index, embeddingModel, languageModel, onEvent })      │
│                                                                                            │
│  bundled: help/index.json (committed, ships with deploy)                                    │
│  env:     GOOGLE_GENERATIVE_AI_API_KEY (consumer's existing key)                            │
└───────────────┬───────────────────────────────────────────────────────┬────────────────────┘
                │ POST /api/help/chat { message, history }                 │ GET (range) mp4 + vtt
                ▼                                                          ▼
   in-process: embed(query) → cosine vs index → gate →             Cloudflare R2 (public)
   answer(AI SDK) → validate stepIds → ChatResponse                help/<version>/<demo>/output.mp4
                │                                                          (+ captions.vtt)
                │ onEvent(e)
                ▼
   generic webhook (v1 sink) → consumer routes anywhere → "top questions / no-match rate"

        ▲ build/publish (CI, no browser)
        │   npx daymo publish:
        │     1. read pre-rendered mp4s + per-scene events.json + step-index.json
        │     2. index: embed each step (pinned model) → index.json
        │     3. upload mp4s + captions to R2 under help/<version>/
        │     4. write/commit index.json (pointed at the R2 video base)
        │
   ┌────┴─────────────────────────────────────────────────────────────────┐
   │ RENDER (dedicated CI job — Chromium+ffmpeg; in-file mocks make it hermetic)│
   │   daymo render / daymo edit  →  output.mp4 + captions.vtt + events.json  │
   └─────────────────────────────────────────────────────────────────────────┘
```

## Deliverables and their interfaces

| Unit | Owns | Interface | Status |
|---|---|---|---|
| **Framework-agnostic chat core** | retrieval + gate + answer + validation as a pure function | `answerChat(input, deps) → { status, body }` | refactor of existing `handleChat` |
| **`daymo/next` route factory** | Next adapter: body parse + limit, CORS, rate limit, calls core | `createChatRoute(opts) → POST handler` | net-new (ports policy out of `server.ts`) |
| **`daymo/react` `<HelpCenter>`** | gallery (from `manifest.json`) + chat UI | React component, config via props | net-new full-page surface |
| **vanilla script build** | same UI for non-React consumers | `<script>` + `data-*` config | wraps the above |
| **`daymo publish` CLI** | index + upload + point index | `npx daymo publish` reading `daymo.config.json` | net-new |
| **observability hook** | per-request outcome events | `onEvent(e)` → generic webhook (v1) | net-new |

### Reused as-is (verified in code)
- RAG retrieval **modules** (`src/chat-server/retrieve.ts`, `cosine.ts`, `bm25.ts`) — pure, lifted unchanged.
- Answer + rewrite LLM already on Vercel AI SDK (`src/chat-server/llm.ts`), using `gemini-2.5-flash` (`llm.ts:6-7`).
- `stepId` validation (`src/chat-server/validate-response.ts`).
- The score gate (`SCORE_THRESHOLD = 0.35`, `chat.ts:9`) — carried as-is; this **supersedes the `0.55` in the prior spec**.

  (Note: the *handler* `handleChat` is **not** reused as-is — it writes to a Node `ServerResponse`; only the pure modules above are. See Net-new #3.)
- Media-fragment playback + a `timeupdate` end-guard (`widget/src/mount.ts`, `render-parts.ts`).
- Byte-range mp4 serving exists (`src/chat-server/handlers/mp4.ts`) — but in self-host, R2 serves
  ranges instead of Daymo.
- `index.json` already carries `demos[]` (`src/types.ts`) and records `embeddingModel`
  (`src/indexer/write-index.ts`).
- `stitch` and `index` CLI commands exist (`src/commands/`).

### Net-new (the actual work)
1. **The gallery + React wrapper.** The existing widget is vanilla DOM and chat-only — no gallery,
   no full-page mode, no React. Generate the gallery from the published `manifest.json` (not the
   embedded `index.json` — see Decision #10 / "Gallery data").
2. **`daymo publish`** (does not exist; the existing CLI has render/stitch/index/serve, no publish/upload).
3. **The framework-agnostic core + `daymo/next` factory.** `handleChat` currently writes to a Node
   `ServerResponse` (`handlers/chat.ts`), and policy (CORS / origin / rate-limit / 1 MB body cap)
   lives in `server.ts`, not the handler. Both must be re-homed so nothing is silently dropped.
4. **Embedder on the AI SDK** (`embedder-gemini.ts` is a hand-rolled `fetch`). The current code
   **already correctly** uses `taskType: RETRIEVAL_DOCUMENT` at index time (`embedder-gemini.ts:41`)
   and `RETRIEVAL_QUERY` at query time (`:59`). **Migration risk:** `@ai-sdk/google`'s
   `textEmbeddingModel()` may not expose per-call `taskType`; if it doesn't, a naive port silently
   regresses recall. Confirm this before porting (Open Question #6) — if unsupported, keep the raw
   `fetch` embedder rather than force the AI SDK here.
5. **Widen `IndexFile.embeddingModel`** from the hardcoded literal `"gemini-embedding-001"`
   (`types.ts:207`) to a configurable string, and thread the chosen model through the three sites
   that hardcode it today: `embedder-gemini.ts:1`, `write-index.ts:100`, `types.ts:207`.
6. **The `onEvent` observability hook** (no instrumentation exists today) → generic webhook sink.
   (The Daymo-hosted collector is v2 — see Scope.)
7. **Single-tenant collapse** of `widgetId` / `allowedOrigins`.
8. **Embedding-model validation** at query time (recorded today, but unenforced).

## Contracts (the load-bearing interfaces)

### Chat core: `answerChat(input, deps) → CoreResult`

```ts
type CoreInput = {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>; // core caps to last 2 turns
  locale?: string;
  requestId: string;        // supplied by the route adapter
};

type CoreDeps = {
  index: LoadedIndex;       // parsed index.json + a derived stepLookup (built once on cold start)
  embedQuery: (text: string) => Promise<number[]>;   // pinned-model embedder
  rewriteQuery: (input: RewriteInput) => Promise<string>;
  answer: (input: AnswerInput) => Promise<ChatResponse>;
  videoBaseUrl: string;     // R2 base; used to construct VideoPart.mp4Url (replaces buildMp4Url)
  onEvent?: (e: HelpChatEvent) => void;
};

type CoreResult = { status: 200; body: ChatResponse };  // core never errors with 4xx/5xx itself
```

- The core is **pure of HTTP**: no `req`/`res`, no CORS, no rate limit, no body parsing. It returns a
  value; the adapter writes it. `200` is the only status the core emits (a `no_match` is still `200`).
- **Policy moves to `daymo/next`** (net-new, ported out of `server.ts`): JSON body read + 1 MB cap
  (`server.ts:26-35`), rate limit (`server.ts:138`), and history capping. The route maps internal
  failures to `4xx/5xx`.
- `onEvent` is a dep, fired exactly once per call with the outcome.

### Embedding-model guard

On cold start, `createChatRoute` reads `index.embeddingModel` (a string) and the `embeddingModel`
handle's id; if they differ it throws a clear startup error. **Comparison is by model-identity
string**, because differing dims are already caught by `cosine.ts:2`. How to read the id off an
`@ai-sdk/google` `EmbeddingModel` (`.modelId`) is pinned in Open Question #6.

### Gallery data: a `demos`-only manifest (NOT `index.json`)

`daymo publish` writes a small `help/manifest.json` alongside the index:

```ts
type HelpManifest = {
  version: string;
  demos: Array<{
    demoId: string; title: string; description?: string;
    durationMs: number; posterUrl: string;          // R2 thumbnail
    steps: Array<{ stepId: string; description: string; startMs: number }>;
  }>;
};
```

`<HelpCenter>` fetches `manifest.json` (small, no embeddings) to render the gallery. The embedded
`index.json` stays server-side, loaded only by `createChatRoute`. (`/widget-config` is irrelevant
here — it returns no `demos`, `widget-config.ts:18-24`.)

### Video URLs: new index field, baked at publish time

Today `mp4Url` is built server-side as `${baseUrl}/widgets/${widgetId}/demos/${demoId}/output.mp4`
(`mp4-url.ts:9-14`) and the LLM is told to leave `mp4Url=""` (`llm.ts:90`). For self-host:

- `IndexFile` gains `videoBaseUrl` (the R2 base); the `widgetId` path segment is dropped.
- Layout under the bucket: `help/<version>/<demoId>/output.mp4` + `output.vtt` (sibling).
- At response time the core sets `VideoPart.mp4Url = ${videoBaseUrl}/<demoId>/output.mp4` and the UI
  appends the media fragment `#t=startSec,endSec` (as `mount.ts:102` / `render-parts.ts:53` do today).

### Rate-limit key and origin posture (single-tenant)

- No `widgetId`, no `allowedOrigins` (Decision #1). The page is public and same-origin, so origin
  allowlisting is dropped.
- Rate-limit key is the **client IP from `x-forwarded-for`** (Vercel terminates TLS, so
  `req.socket.remoteAddress` is the proxy — must read the header, as `server.ts:38-40` already does).
  Default 30/min.

## The consumer footprint

What the consumer writes/provisions:
- `daymo.config.json` — demo sources, R2 bucket + creds (env refs), pinned embedding model, version.
- CI: one line, `npx daymo publish`.
- `app/help/page.tsx` — render `<HelpCenter>` (~5 lines; all visuals are props/theme).
- `app/api/help/chat/route.ts` — `createChatRoute({ index, embeddingModel, languageModel, onEvent })` (~6 lines).
- A Cloudflare R2 bucket (free tier covers a help corpus; zero egress).
- An AI key for the embedding provider (typenote already has `GOOGLE_GENERATIVE_AI_API_KEY`).

Reused, zero net-new: AI key, analytics destination, Vercel compute, the deploy pipeline.

### Example wiring

```tsx
// app/help/page.tsx
import { HelpCenter } from "daymo/react";
export default function Help() {
  return <HelpCenter
    manifestUrl="/help/manifest.json"   // demos-only, no embeddings
    chatEndpoint="/api/help/chat"
    title="typenote Help"
    theme={{ brand: "#4f46e5", radius: 12 }}
    locale="en"
    layout="gallery+chat"
  />;
}
```

```ts
// app/api/help/chat/route.ts
import { createChatRoute } from "daymo/next";
import { google } from "@ai-sdk/google";
import indexJson from "@/help/index.json";

export const POST = createChatRoute({
  index: indexJson,                                                  // bundled object (or { indexUrl })
  embeddingModel: google.textEmbeddingModel("gemini-embedding-001"), // id must match index.embeddingModel
  languageModel:  google("gemini-2.5-flash"),                        // any provider
  rateLimitPerMinute: 30,
  onEvent: (e) => fetch(process.env.HELP_EVENT_WEBHOOK!, {           // v1 sink = generic webhook
    method: "POST", body: JSON.stringify(e),
  }),
});
```

## `daymo publish` (new CLI)

Reads `daymo.config.json`. Assumes mp4s + per-scene `events.json` + `step-index.json` already
exist (produced by the `daymo render`/`stitch` job earlier in the same CI pipeline). Steps:

1. **Index** — for each step, assemble canonical text, embed via the **pinned** model
   (`embeddingModel` written into `index.json`), tokenize keywords for BM25. Incremental: hash per
   chunk, only re-embed changed chunks.
2. **Upload** — push mp4s + `captions.vtt` to R2 under `help/<version>/<demoId>/` (version =
   config or git tag). Public-read.
3. **Point** — write `index.json` with each step's video base URL set to the R2 path. Either commit
   it into the consumer repo (default; versions with the deploy) or upload to a stable index URL.

`daymo publish` runs no browser and needs only the AI key + R2 creds. Rendering is a prerequisite,
not part of publish.

## Mocking and CI rendering

**Mocking reuses Playwright directly — no new Daymo primitive.** A `.demo` carries its own mocks so
the render is hermetic:
- **Static** responses → the frontmatter `mocks:` block (already a wrapper over `page.route`,
  `mocks.ts:70`).
- **Dynamic / conditional** responses → `page.route(...)` written in the scene's `playwright` block;
  the sandbox already hands the block the live Playwright `Page` (`sandbox.ts`), so the full routing
  API is available with no change.
- **Session / auth** → `auth.storageState` (already supported, `controller.ts:53`).

Precedence: an in-block `page.route` overrides a same-glob frontmatter `mocks:` entry (Playwright runs
the last-registered handler first).

**The render pipeline is a dedicated CI job** (e.g. a GitHub Actions job, NOT the Vercel build):
install Chromium (`playwright install --with-deps chromium`) + ffmpeg, start the target, run
`daymo render --all`, then `daymo publish`. Make it practical with: a content-hash cache on render
outputs (skip unchanged demos), a `matrix` (one job per `.demo`) for cold full renders, and
render-level retry for flake.

**The browser/server boundary (a Playwright fact, not a Daymo gap):** `page.route` intercepts only
requests the **browser** makes. Data a Next.js app fetches **server-side** (Server Components, server
actions, route handlers → Supabase) never touches the browser and cannot be mocked in the `.demo`.
Consequence:
- Screens whose data is **client-fetched** → fully self-contained in the `.demo`; CI needs only
  `next start` + Chromium + ffmpeg, no backend.
- Screens that **SSR their data** → CI must point the *server* at a seeded/mocked backend (reuse the
  consumer's existing e2e environment — e.g. typenote's seeded local Supabase + `storageState`).

Guidance: author help walkthroughs around client-fetched interactions where possible (the
click/type/submit flows that make the best manuals), so demos render fully self-contained in CI.

**Pairs with index-from-R2.** When rendering happens in CI and `daymo publish` uploads the index to
R2, the route can read `index.json` from R2 at runtime (`createChatRoute({ indexUrl })`) instead of
committing it back — removing the commit-then-deploy sequencing. Trade-off: manuals are no longer
pinned to the deploy unless you version the R2 path and point the app at a version.

## Embedding-model contract

- `index.json` records `embeddingModel` (today a hardcoded literal — widen it, Net-new #5).
- `createChatRoute` compares `index.embeddingModel` to the supplied embedder's id **by string** at
  load time and throws on mismatch. Dims alone don't suffice: `cosine.ts:2` already throws on a
  length mismatch, so the *only* silent failure is same-dims-different-model — hence a string check.
  (Full contract under "Embedding-model guard" above.)
- The consumer does **not** choose the embedding model freely; they supply a key for Daymo's pinned
  model. The answer `languageModel` *is* freely swappable.

## Observability

Per-request event emitted by the core (net-new):

```ts
type HelpChatEvent = {
  requestId: string;
  question: string;
  rewrittenQuery: string;
  outcome: "answered" | "no_match" | "error";
  matchedStepIds: string[];
  topCosine: number;
  latencyMs: number;
  tokensIn?: number; tokensOut?: number; costUsd?: number;
  appVersion?: string;   // which manual version answered
};
```

Sink (v1): a **generic webhook** URL the consumer sets — Daymo `POST`s each `HelpChatEvent` to it.
The consumer routes it anywhere (typenote → PostHog; another product → its own store). No PostHog
dependency in Daymo, and no required infra beyond an endpoint that accepts a POST.

The **Daymo-hosted collector + dashboard** (project token, storage, retention, the "top unanswered
questions" view) is a **separate v2 product** — see Scope. v1 ships the hook + webhook only; that is
enough to compute the headline metric (the unanswered-questions feed: a ranked list of what to film
next) on the consumer's side.

## Storage and access posture

- R2 bucket, public-read, version-namespaced (`help/<version>/...`). Old versions retained for
  rollback; cleanup is out of scope for v1.
- **Manual videos are public and hotlinkable.** This is an explicit, accepted change from the
  current origin-checked mp4 serving (`handlers/mp4.ts`) — acceptable because the help page is
  itself public. Signed URLs are a future concern and would forfeit "direct-from-R2, zero egress."
- R2 zero-egress applies to bandwidth; Class A/B operations (incl. range GETs) still bill, but are
  negligible at help-center scale.

## Runtime / serverless notes

- `index.json` is bundled with the deploy and parsed into memory per cold start. The existing
  in-process LRU (`index-cache.ts`) does not survive serverless and is dropped for the single-tenant
  case.
- Cosine over a few hundred 768-dim vectors is microseconds; the embedding API round-trip dominates.
- **Scale limit (stated):** this design targets corpora up to ~low-thousands of steps. Beyond that,
  a vector store + an external index host is a v2 concern.

## Testing

| Layer | What | When |
|---|---|---|
| Chat core (pure fn) | fixture `index.json` + question → expected `ChatResponse`; gate + stepId validation; embedding-model-mismatch throws | every commit |
| Retrieval recall | golden questions → expected stepId in top-3 (recall@3 ≥ 85%) | every commit (gated on real-embed env flag) |
| `daymo/next` route | body limit, CORS, rate limit, 429/502/no_match contract | every commit (mocked models) |
| `daymo publish` | given pre-rendered fixtures, deterministic `index.json` + correct R2 paths; incremental re-embed only on change | every commit (mocked uploader) |
| `<HelpCenter>` | gallery renders from `manifest.json`; chat thread renders `Part[]`; video seeks within 500 ms | every commit (jsdom) + nightly Playwright |
| Observability | `onEvent` fires once per request with correct outcome for answer/no_match/error | every commit |

## v1 MVP cut

### IN
- Framework-agnostic chat core + `daymo/next` factory (CORS, rate limit, body cap ported).
- `daymo/react` `<HelpCenter>` (gallery + chat) + vanilla script build.
- `daymo publish` (index + R2 upload + point index), incremental.
- Embedder on the AI SDK with preserved `taskType`; pinned embedding model + query-time validation.
- Provider-agnostic `onEvent` hook → generic webhook sink.
- `manifest.json` (demos-only) published for the gallery; embedded `index.json` stays server-side.
- `videoBaseUrl` index field + R2 path layout (`help/<version>/<demoId>/`).
- Single-tenant config collapse (no `widgetId`/`allowedOrigins`; IP-from-`x-forwarded-for` rate limit).
- typenote reference integration: `/help` page + `/api/help/chat` route + R2 bucket + CI step.
- CI render job (Chromium+ffmpeg, hash-cached, matrix-parallel) with self-contained in-`.demo` mocks
  (declarative `mocks:` + in-block `page.route`) — reusing Playwright, no new Daymo primitive.

### OUT (v2+)
- **Daymo-hosted collector + dashboard** (project token, storage, retention, "top unanswered
  questions" UI) — its own backend product/spec; v1 emits to a webhook instead.
- Managed tier (Daymo-hosted `/chat`, Daymo holds the key).
- Signed video URLs / private manuals.
- Vector store for large corpora.
- Old-version video garbage collection.
- Localized subtitle tracks per locale.
- A hosted Daymo dashboard beyond the basic collector view.
- A Daymo `setup`-module hook for importing a consumer's own mock helpers / context-level routing
  (not needed — in-`.demo` `page.route` + frontmatter `mocks:` cover the cases; revisit only if
  cross-demo mock duplication becomes painful).
- `context.route` / multi-tab mocking inside a `.demo` (page-scoped `page.route` only).

### Definition of done
typenote can: render manuals in a CI job (Chromium+ffmpeg, in-file mocks); run `npx daymo publish` in CI to index + upload to R2
(+ write `manifest.json`); deploy; load `typenote.app/help` and see a gallery rendered from
`manifest.json`; ask "how do I X?" and get text + an inline clip that streams from R2 seeked to the
right step; and see each question `POST`ed as a `HelpChatEvent` to the configured webhook — all on
typenote's own Google key, with Daymo as a pure npm dependency.

## Open questions for implementation

1. **Package layout.** One `daymo` package with `daymo/next` + `daymo/react` subpath exports, or
   separate `@daymo/next` / `@daymo/react` packages? Affects peer-dep handling for React.
2. **Index "pointing."** Commit `index.json` into the consumer repo (versions with deploy) vs upload
   to a stable URL the route fetches — support both, default to commit.
3. **R2 client.** Bundle an S3 client in `daymo publish` or shell to `aws`/`rclone`? Leaning bundled
   `@aws-sdk/client-s3` for portability.
4. **Webhook event delivery.** Fire-and-forget `POST`, or buffered/retried? Leaning fire-and-forget
   in v1 (a dropped analytics event must never affect a chat response). (The Daymo-hosted collector
   that consumes this stream is a separate v2 spec — see Scope.)
5. **Gallery grouping.** Group by `.demo` file, by frontmatter section, or flat? `manifest.demos`
   has title/description but no explicit section taxonomy yet.
6. **AI SDK embedder `taskType` + model id.** Confirm `@ai-sdk/google` `textEmbeddingModel()` exposes
   per-call `taskType` (RETRIEVAL_QUERY vs RETRIEVAL_DOCUMENT). If not, keep the raw-`fetch` embedder.
   Also pin how the validator reads the model-identity string off the AI SDK handle (`.modelId`).

## Scope and decomposition

This spec is **one shippable plan**: the self-hosted page — chat core + `daymo/next` +
`<HelpCenter>` (gallery + chat) + `daymo publish` + single-tenant collapse + R2 + the webhook
observability hook. Within it, the **gallery UI** is the largest net-new surface and is its own
milestone (new full-page React + vanilla build + the `manifest.json` data path), but it does not
need a separate spec.

**Explicitly carved out into its own future spec:** the **Daymo-hosted collector + dashboard**. It
is a separate backend product (its own API, project-token auth, storage, retention, and UI) and
must **not block** the self-hosted page. v1 satisfies "Daymo-owned, provider-agnostic observability"
with the `onEvent` → webhook contract; the managed collector is the v2 way to consume that same
event stream without the consumer wiring their own sink.
