# Daymo Chat: hosted interactive manual + embeddable widget (v1)

## Motivation

The 2026-05-14 spec designed a multi-tenant chat widget that customers embed on their site, with Daymo running a SaaS backend that holds their artifacts. That shape is right for one class of customer — Ron's other project, where he controls both sides — but wrong as Daymo's go-to-market path: every prospect with a security team will trigger a months-long vendor review before they can ship a widget that POSTs to `daymo.dev`.

This v1 keeps the widget surface (because the other project needs it) and adds a second surface that needs zero customer-side install: a **hosted interactive manual** at `daymo.dev/<companyId>/help`. The customer's "deployment" is a link in an email or a docs page. No script tag, no handler to mount, no vendor questionnaire.

Both surfaces share one backend, one indexer, and one `ChatResponse` shape. The widget bundle from the 2026-05-14 spec is reused unchanged. What's new is the hosted-manual frontend, Vercel deployment, and a `daymo publish` flow that replaces "drop files in a directory."

## Relationship to the 2026-05-14 spec

| Reused unchanged | Replaced / new |
|---|---|
| Stitcher extension: `step-index.json`, `-g 30` keyframes | Storage moves from local filesystem to Vercel Blob |
| Indexer: pure function over (`.demo` + `events.json` + `step-index.json` + `mp4`) → `index.json` | Publish flow: `daymo publish` CLI replaces manual file drop |
| Chat backend pipeline: rewrite → embed → retrieve → score gate → answer → validate | Hosted manual frontend (`/<companyId>/help`) is new |
| `ChatResponse` schema (TextPart / VideoPart, ≤6 parts, ≤3 video) | Backend runs as Vercel functions, not a custom HTTP server |
| Widget bundle: shadow DOM, state machine, video element, mobile fullscreen, a11y | LLM stack: Gemini Flash for the answer (was Sonnet); Gemini embeddings unchanged |
| Testing approach: golden questions, axe-core, snapshot tests | Multi-tenancy via URL path (`/<companyId>/help`), not just opaque widgetId |
| ETag-based index re-build | Auth: admin token gates publish; end-users anonymous + IP-rate-limited |

Reading the 2026-05-14 spec before this one is helpful but not required — every reused contract is referenced inline when it matters.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Two surfaces, one backend.** Hosted manual is Daymo's primary product; widget is shipped for Ron's other project and as a Phase 2 offer for customers who later ask | Pre-PMF, the hosted manual gets customers to "try it" in 30 seconds. The widget is the eventual upgrade for those who love it. |
| 2 | **Vercel (Next.js app router + Vercel Blob + Vercel functions)** | One platform covers static pages, API routes, edge cache, blob storage, and deploy ergonomics. Zero infra ops. Easy to move off later because functions are framework-portable. |
| 3 | **Gemini for embeddings AND answer** (`gemini-embedding-001` + `gemini-2.5-flash`) | One API key. Cheaper than the Anthropic path (~$0.001/query vs ~$0.003). Flash supports JSON-schema-constrained output, which the `ChatResponse` enforcement needs. |
| 4 | **Multi-tenancy via URL path: `daymo.dev/<companyId>/help`** | Trivial Next.js route. No DNS, no wildcard config. Subdomain support designed as a v1.5 layer on top of the same data model. |
| 5 | **Storage: Vercel Blob, per-company namespace** | Integrated with Vercel, range-request native, pay-per-GB. mp4s served directly from Blob CDN (no compute). |
| 6 | **Publish flow: `daymo publish <demo-dir> --company <id>`** CLI → `POST /api/admin/publish` with admin token → writes to Blob | One CLI command does everything: build index, upload mp4s, upload index.json, create-or-update company config. Replaces the manual file drop. |
| 7 | **No end-user auth in v1.** Anonymous browsing, IP-based rate limit (30 req/min per IP per company) | The hosted manual is for prospects discovering the product. Auth comes when customers ask for "logged-in only" mode. |
| 8 | **Admin token in env var** for v1; per-company tokens / dashboard come later | Daymo team holds one token, runs `daymo publish` on behalf of early customers. Self-serve dashboard is v2. |
| 9 | **Self-host is dropped from v1** | Revisit when an enterprise customer demands it. Until then, all infrastructure is on Daymo. |

## System overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│  END USER'S BROWSER                                                       │
│                                                                           │
│  Surface A:  daymo.dev/acme/help                                          │
│  ──────────  Full-page Next.js page, server-rendered chrome, client       │
│              chat panel + inline <video>.                                 │
│                                                                           │
│  Surface B:  <script async src="https://daymo.dev/widget.js"              │
│  ──────────         data-company-id="acme"></script>                      │
│              Shadow-DOM floating bubble, same chat panel internals.       │
│              Used by Ron's other project; available for Phase 2 customers.│
└──────────────────┬──────────────────────────┬─────────────────────────────┘
                   │                          │
                   │  POST /api/chat          │  GET <Blob URL>/...output.mp4
                   │  GET  /api/widget-config │  (range, served by Blob CDN,
                   │                          │   no Daymo compute)
                   ▼                          ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  VERCEL                                                                    │
│                                                                            │
│  app/api/chat/route.ts                                                     │
│    rewrite (gemini-flash) → embed (gemini-embedding-001) → cosine+BM25    │
│    → score gate → answer (gemini-flash json_schema) → validate stepIds    │
│                                                                            │
│  app/api/widget-config/route.ts                                            │
│  app/api/admin/publish/route.ts   (admin-token-gated; writes Blob)         │
│                                                                            │
│  app/[companyId]/help/page.tsx    (hosted manual)                          │
│  public/widget.js                  (built widget bundle, static)           │
│                                                                            │
│  Vercel Blob (LRU-cached in function memory, ~50 companies resident)       │
│    companies/<id>/config.json                                              │
│    companies/<id>/index.json                                               │
│    companies/<id>/demos/<demoId>/output.mp4                                │
│    companies/<id>/demos/<demoId>/captions.vtt                              │
└────────────────────────────────────────▲──────────────────────────────────┘
                                         │
                                         │ POST /api/admin/publish
                                         │ (multipart: config + index + mp4s,
                                         │  Authorization: Bearer <admin-token>)
                                         │
┌────────────────────────────────────────┴──────────────────────────────────┐
│  AUTHOR'S LAPTOP                                                           │
│                                                                            │
│  daymo render my.demo                                                      │
│    → output.mp4 + .daymo/step-index.json + events.json                    │
│                                                                            │
│  daymo index my.demo --out ./out                                           │
│    → out/index.json (NEW indexer subcommand)                              │
│                                                                            │
│  daymo publish ./demo-dir --company acme [--name "Acme Inc"]              │
│    → uploads to /api/admin/publish; returns hosted URL                    │
└───────────────────────────────────────────────────────────────────────────┘
```

Four delivery units with clean interfaces:

| Unit | Owns | Interface to outside |
|---|---|---|
| **Stitcher + indexer** (reused) | step-index, mp4 encoding, embedded chunks | Files: `output.mp4`, `step-index.json`, `index.json` |
| **`daymo publish` CLI** (new) | Packaging + upload | HTTPS POST to `/api/admin/publish` |
| **Vercel backend** (new shell, reused pipeline) | `/api/chat`, `/api/widget-config`, `/api/admin/publish`; Blob reads | HTTP only |
| **Two frontends** (one new, one reused) | Hosted manual page; widget bundle | Talk only to `/api/chat` + `/api/widget-config` |

## Storage layout (Vercel Blob)

```
blob://daymo/
  companies/
    acme/
      config.json         { companyId, name, brandColor?, locale, allowedOrigins[], suggestedQuestions[], createdAt }
      index.json          chunks + embeddings + merged step-index (per 2026-05-14 spec)
      demos/
        loomly-tour/
          output.mp4
          captions.vtt   (optional)
```

Blob URLs are public-by-default with unguessable random suffixes (`*.public.blob.vercel-storage.com/...`). For v1 we treat them as opaque — the URL itself is the access token. The mp4 URLs returned in `ChatResponse.parts[].mp4Url` are the canonical Blob URLs; the browser fetches them directly (no Vercel function in the path, no compute cost).

`config.json` and `index.json` are read by the `/api/chat` function and cached in an LRU keyed by `companyId` (~50 resident, ~300KB each). Cache is invalidated on publish via an in-process flag the publish endpoint sets.

## Surface A: hosted interactive manual

### Route

`app/[companyId]/help/page.tsx` — server component that:

1. Fetches `companies/<companyId>/config.json` from Blob.
2. If missing → 404 page.
3. Renders chrome (page title from `config.name`, optional brand color, suggested-question chips) and mounts the client chat panel.

The chat panel is the same React component used inside the widget's shadow DOM, lifted to a top-level page layout. It speaks to `/api/chat` (POST) and renders `Part[]` (text + inline `<video>`).

### Page layout

```
┌──────────────────────────────────────────────────────────┐
│  Acme Inc — Product Manual                               │
│                                                          │
│  Ask me anything about Acme. I'll show you how.          │
│                                                          │
│  [How do I create a project?]                            │
│  [How do I invite a teammate?]    ← suggestion chips     │
│  [How do I export?]                                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Chat thread                                     │   │
│  │  (empty until first question)                    │   │
│  │                                                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Ask a question…                              [→]│   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  powered by daymo                                        │
└──────────────────────────────────────────────────────────┘
```

- **Server-rendered shell** for SEO and fast first paint.
- **Client-rendered chat panel** for interactivity (state machine identical to the widget's, just full-width instead of 320px-bubble-anchored).
- **Mobile**: same layout, full viewport. No fullscreen modal because the page already *is* the chat.

### Shareable answers

Each chat answer can be linked to via `?q=<urlencoded-question>` — visiting `daymo.dev/acme/help?q=how+do+i+export` pre-fills the input and auto-submits. This makes answers easy to share in support tickets, Slack threads, etc.

### Discovery surface (out of v1)

A future addition: `/<companyId>/help` shows the chat by default; `/<companyId>/help/demos` lists all demos as a browsable index with thumbnails. v1 ships chat-only — discovery via the suggested-question chips is enough.

## Surface B: embeddable widget

Unchanged from the 2026-05-14 spec, with two updates:

1. **Identifier:** `data-company-id="acme"` replaces the 2026-05-14 spec's `data-widget-id="wgt_abc123"`. Friendlier name, and matches the path-based URL the hosted manual uses. (The 2026-05-14 widget hasn't shipped, so no back-compat needed.)
2. **Backend target:** widget POSTs to `https://daymo.dev/api/chat` instead of an old SaaS host.

The shadow-DOM bubble, state machine, video player, mobile fullscreen, eight-locale chrome strings, and a11y treatment all carry over without changes. See `docs/superpowers/specs/2026-05-14-demo-chat-widget-design.md` sections "Widget bundle" and "Mobile layout" for full detail.

### Origin allowlist

For the widget, `config.allowedOrigins` still gates `/api/chat` requests by the `Origin` header. For the hosted manual, the same endpoint accepts requests with `Origin: https://daymo.dev` regardless of `allowedOrigins`. This is enforced server-side based on the request's own `Origin`, not by the client.

## Backend on Vercel

### `POST /api/chat`

Body unchanged from 2026-05-14 except `widgetId` becomes `companyId`:

```ts
{
  companyId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>; // ≤2 turns
  locale?: string;
}
```

Response shape (`ChatResponse`) unchanged.

Pipeline unchanged (rewrite → embed → retrieve → score gate → answer → server-validate), with one provider swap:

| Stage | 2026-05-14 spec | This spec | Why changed |
|---|---|---|---|
| Query rewrite | Anthropic Haiku 4.5 | Gemini 2.5 Flash | One provider, one key |
| Embeddings | Gemini Embedding 001 | Gemini Embedding 001 | Unchanged |
| Answer LLM | Anthropic Sonnet 4.6 | Gemini 2.5 Flash (response_schema) | One provider; Flash is cheaper and supports JSON-schema output natively |

Latency budget revised: **~1.0s p50, ~1.8s p95** (Flash is faster than Sonnet for our prompt size). Cost: **~$0.001/query** (down from ~$0.003).

### `GET /api/widget-config?companyId=<id>`

Returns `{ name, brandColor?, locale, suggestedQuestions[] }` from the company's `config.json`. Used by both surfaces on first render. Edge-cached for 60s with `s-maxage=60, stale-while-revalidate=600`.

### `POST /api/admin/publish` (new)

Authenticated endpoint hit by `daymo publish`:

- `Authorization: Bearer <admin-token>` — single env var (`DAYMO_ADMIN_TOKEN`) for v1.
- Multipart body containing:
  - `companyId` (form field)
  - `name`, `brandColor?`, `locale?`, `allowedOrigins?` (form fields, optional updates)
  - `index.json` (file)
  - One or more `demos/<demoId>/output.mp4` files
  - Optional `demos/<demoId>/captions.vtt` files
- Writes everything to Blob under `companies/<companyId>/`.
- Updates `config.json` (merges with existing if present).
- Invalidates in-process LRU cache for that companyId.
- Returns `{ hostedUrl: "https://daymo.dev/<companyId>/help", uploadedAt }`.

Failure modes:
- Missing/invalid token → 401
- File too large (Vercel function body limit ~4.5MB; mp4s often exceed this) → use Blob's client-direct-upload pattern: the function returns a short-lived upload URL, the CLI uploads directly to Blob, then notifies the function to finalize.

This is a v1 wrinkle worth calling out: large mp4 uploads cannot go through a Vercel function body. The CLI uses Vercel Blob's `put` with a server-issued client token (Blob SDK supports this natively). The publish endpoint orchestrates the upload, doesn't proxy bytes.

### Rate limits

- `/api/chat`: 30 req/min per `(companyId, client IP)`. Use Vercel KV (Upstash Redis under the hood) for the counter. 429 + `Retry-After` on excess.
- `/api/admin/publish`: 60 req/min per admin token. (Generous; only Daymo team uses it in v1.)
- `/api/widget-config`: no rate limit (edge-cached).

## Publish flow (`daymo publish`)

New CLI subcommand. File: `src/commands/publish.ts`. Wired into `src/cli.ts` alongside the existing `render`, `capture`, `stitch`, `state`, `edit`, `doctor`, `set-prose`, `migrate-prose` commands.

### Invocation

```bash
daymo publish <demo-dir-or-file> \
  --company acme \
  [--name "Acme Inc"] \
  [--brand-color "#3b82f6"] \
  [--locale en] \
  [--allowed-origin https://acme.com] \
  [--endpoint https://daymo.dev] \
  [--token $DAYMO_ADMIN_TOKEN]
```

### Steps

1. **Resolve inputs.** If `<demo-dir-or-file>` is a `.demo` file, treat it as a single-demo publish. If a directory, treat every `.demo` file inside as part of the company's manual.
2. **Verify artifacts.** For each demo: `output.mp4`, `.daymo/step-index.json`, per-scene `.daymo/<scene>/events.json` must exist. Else fail with "run `daymo render` first."
3. **Run indexer.** Build `index.json` from all demos (the indexer is the same pure function from the 2026-05-14 spec, invoked in-process by the CLI).
4. **Request upload tokens.** `POST /api/admin/publish/begin` with company metadata; backend returns `{ uploadId, blobTokens: { "demos/loomly-tour/output.mp4": "...", ... }, indexBlobToken }`.
5. **Upload to Blob directly.** Use `@vercel/blob/client` `put()` with each token. Concurrent uploads, progress bar.
6. **Finalize.** `POST /api/admin/publish/finalize` with `{ uploadId }`. Backend writes `config.json`, invalidates cache, returns `{ hostedUrl }`.
7. **Print result:**
   ```
   ✓ Published Acme Inc to https://daymo.dev/acme/help
     1 demo (loomly-tour), 23 indexed steps, 47.2MB
   ```

### Re-publishing

Re-running `daymo publish` for an existing companyId replaces `index.json` and overwrites any uploaded mp4s with matching `demoId`s. Mp4s that exist in Blob but no longer correspond to any demo in the publish are **not** deleted (v1 conservative default; explicit `--prune` flag adds deletion). This avoids accidentally orphaning links if the author refactors their `.demo` file structure.

### Doctor check

`daymo doctor` (existing command) gains a check: if `DAYMO_ADMIN_TOKEN` is set, ping `/api/admin/publish/health` to verify the token is valid and the endpoint is reachable.

## Multi-tenancy and isolation

- **Backend never accepts a cross-company query.** Every `/api/chat` request must specify `companyId`; the function reads only that company's `index.json`. No retrieval ever crosses companies.
- **Origin enforcement** (widget only): If the request is *not* from `daymo.dev` (hosted manual), the `Origin` header must be in `config.allowedOrigins`. Hosted manual requests bypass origin check because they're same-origin.
- **Blob namespaces** are path-prefixed by `companyId`. Publish-side validates `companyId` matches `^[a-z0-9-]{1,32}$` (no path traversal) and is not in a reserved-route blocklist: `api`, `widget.js`, `_next`, `favicon.ico`, `robots.txt`, `sitemap.xml`, `admin`, `health`. The Next.js dynamic route `app/[companyId]/help/page.tsx` performs the same check at render time and 404s on reserved names — defense in depth in case a reserved companyId ever lands in Blob.
- **Admin token** scopes to all operations across all companies in v1. Per-company tokens are v2 (when the dashboard ships).

## Vercel-specific constraints and how we handle them

| Constraint | Handling |
|---|---|
| Function timeout (10s hobby / 60s pro) | `/api/chat` runs in ~1-2s, well within hobby limits. Use Node runtime, not Edge runtime, because the Gemini SDK works better in Node. |
| Function body size (~4.5MB) | Bypass for mp4s via Blob direct-upload (CLI uploads to Blob with server-issued token, never through the function). |
| Cold starts | LRU cache survives within a warm function instance. First request after a cold start re-fetches the index from Blob (~50-100ms extra). Acceptable for v1; pre-warming or Edge config is a v2 optimization. |
| Read-only filesystem at runtime | All persistent state in Blob. No `/tmp` writes (Vercel allows them but they're per-instance and ephemeral). |
| Response streaming | Not used in v1 — `/api/chat` returns the full `ChatResponse` JSON at once. Streaming the answer is a v2 UX upgrade. |
| Edge cache for `widget.js` and `widget-config` | `widget.js` is a static asset (`public/widget.js`), auto-cached by Vercel CDN. `widget-config` uses `s-maxage=60, stale-while-revalidate=600`. |

## Testing

Layered the same way as the 2026-05-14 spec, plus new layers for the hosted manual and publish flow:

| Layer | What's tested | When |
|---|---|---|
| Stitcher offset math | Multi-scene global ms; recordingOffsetMs trim; ffprobe duration match within 50ms | every commit |
| Indexer (pure function) | Deterministic chunks; stepId → (start,end) map; fx.say bucketing | every commit |
| Retrieval recall | Golden questions per fixture; recall@3 ≥ 85% | every commit, gated by `RUN_EMBED_TESTS=1` |
| Answer LLM behavior | ~20 canned (question, chunks) → ChatResponse snapshots | nightly, gated by `RUN_LLM_TESTS=1` |
| `/api/chat` contract | Happy path, 429, 502, no_match, missing companyId, origin rejection | every commit (Vitest + mocked Gemini) |
| `/api/admin/publish` contract | Token auth; valid + invalid bodies; cache invalidation; Blob writes | every commit (Vitest + mocked Blob) |
| `daymo publish` CLI | E2E against a mock backend: build index, upload, finalize, error handling | every commit |
| Hosted manual page | Playwright: load `/<companyId>/help`, type question, video element seeks within 500ms of stepId start; shareable URL pre-fills input | nightly |
| Widget E2E | Playwright against a fixture customer site (unchanged from 2026-05-14 spec) | nightly |
| Multi-tenancy isolation | Test that a `/api/chat` request for company A cannot retrieve company B's chunks even with crafted payloads | every commit |
| Accessibility | axe-core against hosted manual + widget in all states | every commit |

### Golden questions per fixture

Same `tests/fixtures/demo-chat/<demoName>/golden-questions.json` shape as the 2026-05-14 spec.

## v1 MVP cut

### IN

- Stitcher extension: `step-index.json` + `-g 30` (reused from 2026-05-14 spec; ship if not already in main).
- Indexer (reused) — runs in-process inside `daymo publish`.
- `daymo publish <demo-dir> --company <id>` CLI with Vercel Blob direct-upload flow.
- Vercel Next.js app deployed to `daymo.dev` (or whatever production domain).
- Routes: `app/[companyId]/help/page.tsx`, `app/api/chat/route.ts`, `app/api/widget-config/route.ts`, `app/api/admin/publish/{begin,finalize,health}/route.ts`.
- Widget bundle (`public/widget.js`) — built from the 2026-05-14 spec, identifier renamed `data-company-id`.
- Hosted manual UX: chat panel, suggestion chips, inline video, mobile-responsive, `?q=` deep links.
- Gemini-only chat pipeline (Flash + Embedding 001), one API key in Vercel env.
- Admin token auth on publish; IP rate limit on `/api/chat`.
- Test layers above.

### OUT (v2+)

- Subdomain routing (`acme.daymo.dev/help`) and custom domains (`help.acme.com`)
- Self-serve dashboard (customers manage their own companies, rotate tokens, view question logs)
- Per-company admin tokens
- Self-hosted package
- Discovery surface (`/<companyId>/help/demos` browsable index)
- Streaming responses
- Voice input
- Analytics dashboard surfaced *to customers* (the question-log wedge — v2 product expansion)
- Authenticated end-users / "logged-in-only" mode
- Pre-cut per-step clips
- Localized subtitle tracks per locale (v1 ships source-language captions only)
- Per-customer tunable cosine threshold

### Definition of done

A new customer can be onboarded in under 10 minutes by a Daymo team member:

1. Author has `.demo` files for the customer's product. Runs `daymo render` on each (existing flow).
2. Daymo team member runs:
   ```bash
   daymo publish ./customer-demos \
     --company acme \
     --name "Acme Inc" \
     --token $DAYMO_ADMIN_TOKEN
   ```
3. Within ~2 minutes the CLI prints `https://daymo.dev/acme/help`.
4. The Daymo team member sends the link to the customer.
5. The customer pastes the link into their docs, support emails, or sales follow-ups. Prospects click it, ask questions, and get answers with seek-to-step video clips.

For Ron's other project:
1. Same publish flow with `--company <other-project-id>`.
2. The other project's site includes `<script async src="https://daymo.dev/widget.js" data-company-id="<other-project-id>"></script>`.
3. The widget bubble appears on their site, talks to the same backend.

When both work end-to-end against at least one fixture demo per surface, v1 ships.

## Open questions for implementation

1. **Indexer location in the repo.** The 2026-05-14 spec specifies the indexer as a pure function but doesn't pin the module path. Land it at `src/core/indexer.ts` so both `daymo publish` and any future re-indexer endpoint can import it.
2. **Vercel project structure.** Two reasonable layouts: (a) `apps/web/` for the Vercel app inside the existing monorepo, sharing `src/core/indexer.ts` via workspace deps; (b) standalone `web/` folder with the indexer copied or git-submoduled. Lean toward (a) using npm workspaces — the CLI and the backend should literally import the same indexer module.
3. **Widget bundle build pipeline.** Bundle widget source (TypeScript) → single ES module → emit to `apps/web/public/widget.js` during the Vercel build. Tool choice (esbuild / vite-build / tsup) is tactical.
4. **Gemini JSON schema enforcement.** Gemini 2.5 Flash supports `responseSchema` via `responseMimeType: "application/json"` + `responseSchema`. Validate the v1 SDK supports the `oneOf`/`pattern` constructs we need; if not, post-validate manually before returning.
5. **Vercel Blob client-direct-upload SDK shape.** The `@vercel/blob/client` package's `put()` flow needs a server-issued token. Pin the exact API in the implementation plan after a quick spike against the current SDK version.

None of these change the architecture.
