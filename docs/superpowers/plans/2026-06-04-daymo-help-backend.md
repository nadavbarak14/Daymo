# Daymo Self-Hosted Help — Backend Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing chat backend embeddable and single-tenant: a framework-agnostic `answerChat` core, a `daymo/next` route factory (web `Request`/`Response`), a configurable embedding model with a query-time guard, a `videoBaseUrl` so videos come from a bucket, and a provider-agnostic `onEvent` hook.

**Architecture:** Lift the retrieval/answer pipeline out of `src/chat-server/handlers/chat.ts` (which writes to a Node `ServerResponse`) into a pure function returning `{ status, body }`. Drop the multi-tenant `widgetId`/`loadWidget`/`allowedOrigins` indirection — the consumer passes one bundled `IndexFile`. The existing raw-`fetch` embedder is kept (it already handles `taskType`); only its model string becomes configurable. A new `daymo/next` subpath export adapts the core to a Next.js App Router route handler.

**Tech Stack:** TypeScript (ESM, `"type": "module"`, `.js` import specifiers), vitest, `ai` + `@ai-sdk/google` (LLM, already in use), web Fetch API for the route handler.

**Spec:** `docs/superpowers/specs/2026-06-04-daymo-self-hosted-help-integration-design.md`

**Execution deviations (2026-06-04):** Tasks 1–3 landed as one commit (adding a required `videoBaseUrl` to `IndexFile` forces `write-index.ts` to change in the same commit, so `src` stays compiling). **Task 7 (legacy `handleChat` refactor) was skipped** — re-pointing the multi-tenant `daymo serve` at the new `videoBaseUrl`-based core conflicts with its dynamic per-serve `baseUrl`, risking the existing server/tests for no feature gain; the legacy handler is left untouched and the new self-hosted path uses the chat-core. The embedder was kept on raw `fetch` (model made configurable only), per Net-new #4. Verification gate is `tsc --noEmit` for `src` (tests are not in the tsc program) plus `vitest`. Pre-existing unrelated failure: `tests/integration/stitch-keyframes.test.ts` (ffmpeg GOP count, environment-dependent).

**Out of scope (separate plans):** `daymo publish` CLI + R2 upload + `manifest.json` (Plan A2); `daymo/react` `<HelpCenter>` + vanilla build (Plan A3); typenote integration + CI render/publish (Plan B).

---

## File structure

- Modify: `src/types.ts` — add `videoBaseUrl` to `IndexFile`; widen `embeddingModel` to `string`.
- Modify: `src/indexer/embedder-gemini.ts` — model string becomes a parameter (default unchanged).
- Modify: `src/indexer/write-index.ts` — write the configured model + `videoBaseUrl`.
- Create: `src/chat-core/types.ts` — `LoadedIndex`, `CoreInput`, `CoreDeps`, `CoreResult`, `HelpChatEvent`.
- Create: `src/chat-core/load-index.ts` — build a `LoadedIndex` (stepLookup) from an `IndexFile`.
- Create: `src/chat-core/embedding-guard.ts` — `assertEmbeddingModel(index, modelId)`.
- Create: `src/chat-core/answer-chat.ts` — the pure `answerChat(input, deps)`.
- Create: `src/next/create-chat-route.ts` — `createChatRoute(opts)` → `(req: Request) => Promise<Response>`.
- Create: `src/next/index.ts` — re-export for the `daymo/next` subpath.
- Modify: `package.json` — add the `./next` subpath export.
- Modify: `src/chat-server/handlers/chat.ts` — re-implement on top of `answerChat` (keep the old `node:http` server working).
- Tests: `tests/unit/chat-core/*.test.ts`, `tests/unit/next/*.test.ts`.

---

## Task 1: Index type — `videoBaseUrl` + configurable embedding model

**Files:**
- Modify: `src/types.ts:204-213`
- Test: `tests/unit/types-index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/types-index.test.ts
import { describe, it, expect } from "vitest";
import type { IndexFile } from "../../src/types.js";

describe("IndexFile shape", () => {
  it("accepts a configurable embeddingModel string and a videoBaseUrl", () => {
    const idx: IndexFile = {
      version: "v1",
      widgetId: "help",
      embeddingModel: "some-other-model",        // must compile (was a literal before)
      embeddingDims: 768,
      videoBaseUrl: "https://cdn.example.com/help/v1",
      createdAt: "2026-06-04T00:00:00Z",
      etag: "sha256:abc",
      demos: [],
      chunks: [],
    };
    expect(idx.videoBaseUrl).toContain("https://");
    expect(idx.embeddingModel).toBe("some-other-model");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/types-index.test.ts`
Expected: FAIL — TS error: type `"some-other-model"` not assignable to `"gemini-embedding-001"`, and `videoBaseUrl` does not exist on `IndexFile`.

- [ ] **Step 3: Edit the type**

In `src/types.ts`, change the `IndexFile` interface:

```ts
export interface IndexFile {
  version: "v1";
  widgetId: string;
  embeddingModel: string;        // was: "gemini-embedding-001"
  embeddingDims: number;
  videoBaseUrl: string;          // NEW: bucket base for video files
  createdAt: string;
  etag: string;
  demos: IndexedDemo[];
  chunks: IndexedChunk[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/types-index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/unit/types-index.test.ts
git commit -m "feat(types): configurable embeddingModel + videoBaseUrl on IndexFile"
```

---

## Task 2: Make the embedder model configurable (keep raw fetch)

**Files:**
- Modify: `src/indexer/embedder-gemini.ts`
- Test: `tests/unit/embedder-model.test.ts`

Context: `embedder-gemini.ts` hardcodes `const MODEL = "gemini-embedding-001"` and uses it in the request URL. We thread it as a parameter, defaulting to the same value (no behavior change), and keep the `taskType` handling exactly as-is.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/embedder-model.test.ts
import { describe, it, expect, vi } from "vitest";
import { embedQuery } from "../../src/indexer/embedder-gemini.js";

describe("embedder model is configurable", () => {
  it("uses the model id passed in opts in the request URL", async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ embedding: { values: [0.1, 0.2] } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await embedQuery("hello", { apiKey: "k", model: "text-embedding-xyz", fetchImpl: fetchSpy });
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain("text-embedding-xyz");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/embedder-model.test.ts`
Expected: FAIL — `embedQuery` does not accept `model`/`fetchImpl`; URL contains `gemini-embedding-001`.

- [ ] **Step 3: Edit the embedder**

In `src/indexer/embedder-gemini.ts`, replace the hardcoded `MODEL` constant usage with a parameter. Add an options object to both `embedQuery` and the document-embedding function (`embedDocuments`/`embedMany`, whatever the file exports), and inject `fetchImpl` for testability:

```ts
const DEFAULT_MODEL = "gemini-embedding-001";

export interface EmbedOpts {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export async function embedQuery(text: string, opts: EmbedOpts): Promise<number[]> {
  const model = opts.model ?? DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${opts.apiKey}`;
  const res = await doFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType: "RETRIEVAL_QUERY",     // unchanged — preserves recall
    }),
  });
  if (!res.ok) throw new Error(`embed query failed: ${res.status}`);
  const json = (await res.json()) as { embedding: { values: number[] } };
  return json.embedding.values;
}
```

Apply the same `model`/`fetchImpl` threading to the document-embedding function, keeping its `taskType: "RETRIEVAL_DOCUMENT"`. Update existing callers (`src/commands/index.ts`, `src/commands/serve.ts`) to keep compiling — they pass only `{ apiKey }`, which is still valid (model defaults).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/embedder-model.test.ts`
Expected: PASS

Run: `npx vitest run` (full suite — confirm no caller broke)
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/indexer/embedder-gemini.ts tests/unit/embedder-model.test.ts
git commit -m "feat(indexer): make embedding model configurable (default unchanged)"
```

---

## Task 3: Core types — `LoadedIndex`, `CoreInput`, `CoreDeps`, `CoreResult`, `HelpChatEvent`

**Files:**
- Create: `src/chat-core/types.ts`
- Test: `tests/unit/chat-core/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat-core/types.test.ts
import { describe, it, expect } from "vitest";
import type { CoreDeps, CoreInput, CoreResult, HelpChatEvent, LoadedIndex } from "../../../src/chat-core/types.js";

describe("chat-core types", () => {
  it("compose a minimal CoreDeps/CoreInput", () => {
    const input: CoreInput = { message: "hi", history: [], requestId: "r1" };
    const loaded = { index: {} as LoadedIndex["index"], stepLookup: new Map(), videoBaseUrl: "https://x", suggestedQuestions: [], defaultLocale: "en" } satisfies LoadedIndex;
    const deps: CoreDeps = {
      loaded,
      embedQuery: async () => [0],
      rewriteQuery: async () => "q",
      answer: async () => ({ kind: "no_match", text: "no" }),
    };
    const ev: HelpChatEvent = { requestId: "r1", question: "hi", rewrittenQuery: "q", outcome: "no_match", matchedStepIds: [], topCosine: 0, latencyMs: 1 };
    const result: CoreResult = { status: 200, body: { kind: "no_match", text: "no" } };
    expect(input.requestId).toBe("r1");
    expect(deps.loaded.videoBaseUrl).toContain("https://");
    expect(ev.outcome).toBe("no_match");
    expect(result.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chat-core/types.test.ts`
Expected: FAIL — module `src/chat-core/types.js` not found.

- [ ] **Step 3: Create the types**

```ts
// src/chat-core/types.ts
import type { ChatResponse, IndexedChunk, IndexFile } from "../types.js";

export interface LoadedIndex {
  index: IndexFile;
  stepLookup: Map<string, IndexedChunk>;
  videoBaseUrl: string;
  suggestedQuestions: string[];
  defaultLocale: string;
}

export interface CoreInput {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  locale?: string;
  requestId: string;
}

export type RewriteQueryFn = (input: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) => Promise<string>;

export type AnswerFn = (input: {
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
}) => Promise<ChatResponse>;

export interface HelpChatEvent {
  requestId: string;
  question: string;
  rewrittenQuery: string;
  outcome: "answered" | "no_match" | "error";
  matchedStepIds: string[];
  topCosine: number;
  latencyMs: number;
}

export interface CoreDeps {
  loaded: LoadedIndex;
  embedQuery: (text: string) => Promise<number[]>;
  rewriteQuery: RewriteQueryFn;
  answer: AnswerFn;
  onEvent?: (e: HelpChatEvent) => void;
}

export interface CoreResult {
  status: 200;
  body: ChatResponse;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chat-core/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat-core/types.ts tests/unit/chat-core/types.test.ts
git commit -m "feat(chat-core): define core types (LoadedIndex, CoreInput/Deps/Result, HelpChatEvent)"
```

---

## Task 4: `loadIndex` — build a `LoadedIndex` from an `IndexFile`

**Files:**
- Create: `src/chat-core/load-index.ts`
- Test: `tests/unit/chat-core/load-index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat-core/load-index.test.ts
import { describe, it, expect } from "vitest";
import { loadIndex } from "../../../src/chat-core/load-index.js";
import type { IndexFile } from "../../../src/types.js";

const index: IndexFile = {
  version: "v1", widgetId: "help", embeddingModel: "gemini-embedding-001",
  embeddingDims: 2, videoBaseUrl: "https://cdn/help/v1",
  createdAt: "2026-06-04T00:00:00Z", etag: "sha256:x", demos: [],
  chunks: [{ stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 0, globalEndMs: 10, text: "t", embedding: [0, 1], keywords: ["t"] }],
};

describe("loadIndex", () => {
  it("builds a stepLookup keyed by stepId and carries videoBaseUrl", () => {
    const loaded = loadIndex(index, { suggestedQuestions: ["How do I X?"], defaultLocale: "en" });
    expect(loaded.stepLookup.get("d:0:1")?.demoId).toBe("d");
    expect(loaded.videoBaseUrl).toBe("https://cdn/help/v1");
    expect(loaded.defaultLocale).toBe("en");
  });
  it("rejects an unsupported version", () => {
    expect(() => loadIndex({ ...index, version: "v2" as IndexFile["version"] }, { suggestedQuestions: [], defaultLocale: "en" }))
      .toThrow(/unsupported index version/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chat-core/load-index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/chat-core/load-index.ts
import type { IndexedChunk, IndexFile } from "../types.js";
import type { LoadedIndex } from "./types.js";

export interface LoadIndexOpts {
  suggestedQuestions: string[];
  defaultLocale: string;
}

export function loadIndex(index: IndexFile, opts: LoadIndexOpts): LoadedIndex {
  if (index.version !== "v1") {
    throw new Error(`unsupported index version: ${index.version}`);
  }
  const stepLookup = new Map<string, IndexedChunk>();
  for (const c of index.chunks) stepLookup.set(c.stepId, c);
  return {
    index,
    stepLookup,
    videoBaseUrl: index.videoBaseUrl,
    suggestedQuestions: opts.suggestedQuestions,
    defaultLocale: opts.defaultLocale,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chat-core/load-index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat-core/load-index.ts tests/unit/chat-core/load-index.test.ts
git commit -m "feat(chat-core): loadIndex builds stepLookup from a bundled IndexFile"
```

---

## Task 5: Embedding-model guard

**Files:**
- Create: `src/chat-core/embedding-guard.ts`
- Test: `tests/unit/chat-core/embedding-guard.test.ts`

Context (spec): dimension mismatch is already caught by `cosine.ts`. The only *silent* failure is same-dims-different-model, so the guard compares the **model string**.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat-core/embedding-guard.test.ts
import { describe, it, expect } from "vitest";
import { assertEmbeddingModel } from "../../../src/chat-core/embedding-guard.js";

describe("assertEmbeddingModel", () => {
  it("passes when ids match", () => {
    expect(() => assertEmbeddingModel("gemini-embedding-001", "gemini-embedding-001")).not.toThrow();
  });
  it("throws a clear error when the query model differs from the index model", () => {
    expect(() => assertEmbeddingModel("gemini-embedding-001", "text-embedding-3"))
      .toThrow(/index was built with "gemini-embedding-001" but the route is configured with "text-embedding-3"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chat-core/embedding-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/chat-core/embedding-guard.ts
export function assertEmbeddingModel(indexModel: string, configuredModel: string): void {
  if (indexModel !== configuredModel) {
    throw new Error(
      `embedding model mismatch: the index was built with "${indexModel}" but the route is ` +
      `configured with "${configuredModel}". Query and index embeddings must use the same model, ` +
      `or retrieval is silently wrong. Re-publish the index or fix the route's embeddingModelId.`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/chat-core/embedding-guard.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat-core/embedding-guard.ts tests/unit/chat-core/embedding-guard.test.ts
git commit -m "feat(chat-core): assertEmbeddingModel guards index/query model match"
```

---

## Task 6: `answerChat` — the pure core

**Files:**
- Create: `src/chat-core/answer-chat.ts`
- Test: `tests/unit/chat-core/answer-chat.test.ts`

Context: this is the extraction of `handlers/chat.ts:31-89` with three changes — (a) no `loadWidget`/`widgetId` (consumer passes one `LoadedIndex`); (b) `VideoPart.mp4Url` is built from `loaded.videoBaseUrl + demoId`, not `buildMp4Url(widgetId)`; (c) it returns `{ status, body }` and fires `onEvent`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/chat-core/answer-chat.test.ts
import { describe, it, expect, vi } from "vitest";
import { answerChat } from "../../../src/chat-core/answer-chat.js";
import { loadIndex } from "../../../src/chat-core/load-index.js";
import type { IndexFile } from "../../../src/types.js";
import type { CoreDeps, HelpChatEvent } from "../../../src/chat-core/types.js";

const index: IndexFile = {
  version: "v1", widgetId: "help", embeddingModel: "gemini-embedding-001",
  embeddingDims: 2, videoBaseUrl: "https://cdn/help/v1",
  createdAt: "2026-06-04T00:00:00Z", etag: "sha256:x", demos: [],
  chunks: [{ stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 100, globalEndMs: 900, text: "create a note", embedding: [1, 0], keywords: ["create", "note"] }],
};

function deps(over: Partial<CoreDeps> = {}): CoreDeps {
  return {
    loaded: loadIndex(index, { suggestedQuestions: ["How do I create a note?"], defaultLocale: "en" }),
    embedQuery: async () => [1, 0],          // identical to the chunk → high cosine
    rewriteQuery: async () => "create note",
    answer: async () => ({ kind: "answer", parts: [
      { kind: "text", text: "Here:" },
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 100, endMs: 900, caption: "create", mp4Url: "" },
    ] }),
    ...over,
  };
}

describe("answerChat", () => {
  it("returns an answer and fills mp4Url from videoBaseUrl", async () => {
    const onEvent = vi.fn();
    const res = await answerChat({ message: "how do I create a note", history: [], requestId: "r1" }, deps({ onEvent }));
    expect(res.status).toBe(200);
    if (res.body.kind !== "answer") throw new Error("expected answer");
    const video = res.body.parts.find(p => p.kind === "video");
    expect(video && "mp4Url" in video && video.mp4Url).toBe("https://cdn/help/v1/d/output.mp4");
    const ev = onEvent.mock.calls[0][0] as HelpChatEvent;
    expect(ev.outcome).toBe("answered");
    expect(ev.matchedStepIds).toContain("d:0:1");
  });

  it("returns no_match (with suggestions) when top cosine is below threshold", async () => {
    const res = await answerChat(
      { message: "unrelated", history: [], requestId: "r2" },
      deps({ embedQuery: async () => [0, 1] }),   // orthogonal → low cosine
    );
    expect(res.body.kind).toBe("no_match");
    if (res.body.kind === "no_match") expect(res.body.suggestions).toEqual(["How do I create a note?"]);
  });

  it("downgrades to no_match when the LLM returns an unknown stepId", async () => {
    const res = await answerChat(
      { message: "create", history: [], requestId: "r3" },
      deps({ answer: async () => ({ kind: "answer", parts: [
        { kind: "video", stepId: "does-not-exist", demoId: "d", startMs: 0, endMs: 1, caption: "x", mp4Url: "" },
      ] }) }),
    );
    expect(res.body.kind).toBe("no_match");
  });

  it("caps history to the last 2 turns before rewrite", async () => {
    const rewriteQuery = vi.fn(async () => "create note");
    const history = [
      { role: "user" as const, content: "a" }, { role: "assistant" as const, content: "b" },
      { role: "user" as const, content: "c" }, { role: "assistant" as const, content: "d" },
    ];
    await answerChat({ message: "more", history, requestId: "r4" }, deps({ rewriteQuery }));
    expect(rewriteQuery.mock.calls[0][0].history).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chat-core/answer-chat.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/chat-core/answer-chat.ts
import type { ChatResponse, Part, VideoPart } from "../types.js";
import { retrieve } from "../chat-server/retrieve.js";
import { extractKeywords } from "../indexer/keywords.js";
import { validateChatResponse } from "../chat-server/validate-response.js";
import type { CoreDeps, CoreInput, CoreResult, HelpChatEvent } from "./types.js";

const SCORE_THRESHOLD = 0.35;

export async function answerChat(input: CoreInput, deps: CoreDeps): Promise<CoreResult> {
  const startedAt = performance.now();
  const { loaded } = deps;
  const locale = input.locale ?? loaded.defaultLocale;
  const history = input.history.slice(-2);

  const emit = (outcome: HelpChatEvent["outcome"], rewritten: string, topCosine: number, stepIds: string[]) => {
    deps.onEvent?.({
      requestId: input.requestId,
      question: input.message,
      rewrittenQuery: rewritten,
      outcome,
      matchedStepIds: stepIds,
      topCosine,
      latencyMs: Math.round(performance.now() - startedAt),
    });
  };

  const rewritten = history.length === 0 ? input.message : await deps.rewriteQuery({ message: input.message, history });

  const queryEmbedding = await deps.embedQuery(rewritten);
  const retrieval = retrieve({
    query: { embedding: queryEmbedding, keywords: extractKeywords(rewritten) },
    chunks: loaded.index.chunks,
    k: 8,
  });

  if (retrieval.topCosineScore < SCORE_THRESHOLD) {
    emit("no_match", rewritten, retrieval.topCosineScore, []);
    return { status: 200, body: noMatch(loaded.suggestedQuestions) };
  }

  let response = await deps.answer({ query: rewritten, history, chunks: retrieval.chunks, locale });

  if (response.kind === "answer") {
    response = {
      kind: "answer",
      parts: response.parts.map((p): Part => {
        if (p.kind !== "video") return p;
        const v = p as VideoPart;
        return { ...v, mp4Url: `${loaded.videoBaseUrl}/${v.demoId}/output.mp4` };
      }),
    };
  }

  const validation = validateChatResponse(response, loaded.stepLookup);
  if (!validation.ok) {
    emit("no_match", rewritten, retrieval.topCosineScore, []);
    return { status: 200, body: noMatch(loaded.suggestedQuestions) };
  }

  const stepIds = response.kind === "answer"
    ? response.parts.filter((p): p is VideoPart => p.kind === "video").map(p => p.stepId)
    : [];
  emit(response.kind === "answer" ? "answered" : "no_match", rewritten, retrieval.topCosineScore, stepIds);
  return { status: 200, body: response };
}

function noMatch(suggestions: string[]): ChatResponse {
  return { kind: "no_match", text: "I don't have that in the demos. Try one of these:", suggestions: suggestions.slice(0, 3) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/chat-core/answer-chat.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/chat-core/answer-chat.ts tests/unit/chat-core/answer-chat.test.ts
git commit -m "feat(chat-core): pure answerChat with onEvent + videoBaseUrl mp4 URLs"
```

---

## Task 7: Re-implement the legacy `node:http` handler on top of `answerChat`

**Files:**
- Modify: `src/chat-server/handlers/chat.ts`
- Test: `tests/unit/legacy-chat-handler.test.ts` (new, light) + existing server tests

Context: keep the existing multi-tenant `daymo serve` working by having `handleChat` build a `LoadedIndex` from the loaded `CacheEntry` and delegate to `answerChat`, then write the result to `res`. This deletes the duplicate retrieval logic (DRY) while preserving behavior.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/legacy-chat-handler.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleChat } from "../../src/chat-server/handlers/chat.js";
import type { CacheEntry } from "../../src/chat-server/index-cache.js";
import type { IndexFile } from "../../src/types.js";

function fakeRes() {
  return { statusCode: 0, headers: {} as Record<string, string>, body: "",
    setHeader(k: string, v: string) { this.headers[k] = v; },
    end(b?: string) { if (b) this.body = b; } };
}

const index: IndexFile = {
  version: "v1", widgetId: "help", embeddingModel: "gemini-embedding-001", embeddingDims: 2,
  videoBaseUrl: "https://cdn/help/v1", createdAt: "x", etag: "x", demos: [],
  chunks: [{ stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 0, globalEndMs: 9, text: "create note", embedding: [1, 0], keywords: ["create"] }],
};

describe("legacy handleChat delegates to answerChat", () => {
  it("writes a 200 JSON ChatResponse to res", async () => {
    const entry: CacheEntry = {
      index,
      config: { widgetId: "help", name: "Help", locale: "en", allowedOrigins: [], suggestedQuestions: ["How do I create a note?"] },
      stepLookup: new Map(index.chunks.map(c => [c.stepId, c])),
    };
    const res = fakeRes();
    await handleChat({} as never, res as never, { widgetId: "help", message: "create", history: [] }, {
      loadWidget: async () => entry,
      rewriteQueryFn: async () => "create note",
      answerFn: async () => ({ kind: "no_match", text: "no" }),
      embedQueryFn: async () => [0, 1],     // low cosine → no_match path
      baseUrl: "http://localhost",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).kind).toBe("no_match");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/legacy-chat-handler.test.ts`
Expected: FAIL — current `handleChat` still works but this asserts the delegated path; it should pass structurally. If it already passes, proceed (this test pins behavior before the refactor). If the suggestions/threshold differ, it fails — that's the signal to refactor in Step 3.

- [ ] **Step 3: Refactor `handleChat` to delegate**

Replace the body of `handleChat` (keep its signature) so it builds a `LoadedIndex` and calls `answerChat`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatRequest } from "../../types.js";
import { answerChat } from "../../chat-core/answer-chat.js";
import { loadIndex } from "../../chat-core/load-index.js";
import type { CacheEntry } from "../index-cache.js";
import type { RewriteQueryFn, AnswerFn } from "../../chat-core/types.js";

export type { RewriteQueryFn, AnswerFn };

export interface ChatHandlerDeps {
  loadWidget: (id: string) => Promise<CacheEntry>;
  rewriteQueryFn: RewriteQueryFn;
  answerFn: AnswerFn;
  embedQueryFn: (text: string) => Promise<number[]>;
  baseUrl: string;   // retained for signature compat; videoBaseUrl now comes from the index
}

export async function handleChat(
  _req: IncomingMessage, res: ServerResponse, body: ChatRequest, deps: ChatHandlerDeps,
): Promise<void> {
  let entry: CacheEntry;
  try {
    entry = await deps.loadWidget(body.widgetId);
  } catch {
    return sendJson(res, 404, { kind: "no_match", text: "This help widget is not configured." });
  }
  const loaded = loadIndex(entry.index, {
    suggestedQuestions: entry.config.suggestedQuestions,
    defaultLocale: entry.config.locale,
  });
  const result = await answerChat(
    { message: body.message, history: body.history, locale: body.locale, requestId: `${body.widgetId}:${Date.now()}` },
    { loaded, embedQuery: deps.embedQueryFn, rewriteQuery: deps.rewriteQueryFn, answer: deps.answerFn },
  );
  sendJson(res, result.status, result.body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
```

Note: existing fixtures may lack `videoBaseUrl` on the index. Add `videoBaseUrl` to the demo-chat test fixtures' `index.json` (e.g. `tests/fixtures/demo-chat/**/index.json`) — set it to the prior server URL form `http://localhost/widgets/<id>/demos` so the legacy server keeps producing the same mp4 URLs. (`Date.now()` is fine here; this is the legacy server path, not the core.)

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS — the new test passes and existing chat-server tests still pass (update fixture `index.json` files with `videoBaseUrl` if any fail on the missing field).

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/handlers/chat.ts tests/unit/legacy-chat-handler.test.ts tests/fixtures/demo-chat
git commit -m "refactor(chat-server): handleChat delegates to chat-core/answerChat"
```

---

## Task 8: `daymo/next` route factory

**Files:**
- Create: `src/next/create-chat-route.ts`
- Create: `src/next/index.ts`
- Modify: `package.json` (subpath export)
- Test: `tests/unit/next/create-chat-route.test.ts`

Context: the factory adapts the pure core to a web `Request → Response` handler (Next.js App Router). It owns the policy the old `server.ts` wrapper owned: body-size cap, JSON parse, rate limit keyed by IP from `x-forwarded-for`. It runs `assertEmbeddingModel` once at construction. No origin allowlist (public same-origin page).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/next/create-chat-route.test.ts
import { describe, it, expect, vi } from "vitest";
import { createChatRoute } from "../../../src/next/create-chat-route.js";
import type { IndexFile } from "../../../src/types.js";

const index: IndexFile = {
  version: "v1", widgetId: "help", embeddingModel: "gemini-embedding-001", embeddingDims: 2,
  videoBaseUrl: "https://cdn/help/v1", createdAt: "x", etag: "x", demos: [],
  chunks: [{ stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 0, globalEndMs: 9, text: "create note", embedding: [1, 0], keywords: ["create"] }],
};

function baseOpts(over = {}) {
  return {
    index, embeddingModelId: "gemini-embedding-001",
    suggestedQuestions: ["How do I create a note?"], defaultLocale: "en",
    embedQuery: async () => [0, 1],
    rewriteQuery: async () => "create note",
    answer: async () => ({ kind: "no_match" as const, text: "no" }),
    rateLimitPerMinute: 2,
    ...over,
  };
}

function req(body: unknown, ip = "1.2.3.4") {
  return new Request("https://app/api/help/chat", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("createChatRoute", () => {
  it("throws at construction on embedding-model mismatch", () => {
    expect(() => createChatRoute(baseOpts({ embeddingModelId: "other" }))).toThrow(/embedding model mismatch/);
  });

  it("returns 200 ChatResponse for a valid request", async () => {
    const POST = createChatRoute(baseOpts());
    const res = await POST(req({ message: "create", history: [] }));
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe("no_match");
  });

  it("returns 400 on invalid body", async () => {
    const POST = createChatRoute(baseOpts());
    const res = await POST(new Request("https://app", { method: "POST", body: "not json", headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(400);
  });

  it("rate-limits by x-forwarded-for IP (429 + Retry-After)", async () => {
    const POST = createChatRoute(baseOpts({ rateLimitPerMinute: 1 }));
    await POST(req({ message: "a", history: [] }, "9.9.9.9"));
    const res = await POST(req({ message: "b", history: [] }, "9.9.9.9"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/next/create-chat-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the factory**

```ts
// src/next/create-chat-route.ts
import type { IndexFile } from "../types.js";
import { answerChat } from "../chat-core/answer-chat.js";
import { loadIndex } from "../chat-core/load-index.js";
import { assertEmbeddingModel } from "../chat-core/embedding-guard.js";
import { createRateLimiter } from "../chat-server/rate-limit.js";
import type { AnswerFn, HelpChatEvent, RewriteQueryFn } from "../chat-core/types.js";

export interface CreateChatRouteOpts {
  index: IndexFile;
  embeddingModelId: string;
  embedQuery: (text: string) => Promise<number[]>;
  rewriteQuery: RewriteQueryFn;
  answer: AnswerFn;
  suggestedQuestions?: string[];
  defaultLocale?: string;
  rateLimitPerMinute?: number;
  maxBodyBytes?: number;
  onEvent?: (e: HelpChatEvent) => void;
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}

let counter = 0;

export function createChatRoute(opts: CreateChatRouteOpts): (req: Request) => Promise<Response> {
  assertEmbeddingModel(opts.index.embeddingModel, opts.embeddingModelId);
  const loaded = loadIndex(opts.index, {
    suggestedQuestions: opts.suggestedQuestions ?? [],
    defaultLocale: opts.defaultLocale ?? "en",
  });
  const limiter = createRateLimiter({ maxPerMinute: opts.rateLimitPerMinute ?? 30 });
  const maxBody = opts.maxBodyBytes ?? 1_000_000;

  return async function POST(req: Request): Promise<Response> {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > maxBody) return json(413, { error: "body too large" });

    const ip = clientIp(req);
    const decision = limiter.check(ip);
    if (!decision.allowed) return json(429, { error: "rate limit exceeded" }, { "Retry-After": String(decision.retryAfterSec) });

    let body: { message?: unknown; history?: unknown; locale?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid body" });
    }
    if (typeof body.message !== "string" || !Array.isArray(body.history)) {
      return json(400, { error: "invalid body" });
    }

    try {
      const result = await answerChat(
        { message: body.message, history: body.history as never, locale: body.locale as string | undefined, requestId: `req_${++counter}` },
        { loaded, embedQuery: opts.embedQuery, rewriteQuery: opts.rewriteQuery, answer: opts.answer, onEvent: opts.onEvent },
      );
      return json(result.status, result.body);
    } catch (err) {
      opts.onEvent?.({ requestId: `req_${counter}`, question: String(body.message), rewrittenQuery: "", outcome: "error", matchedStepIds: [], topCosine: 0, latencyMs: 0 });
      return json(502, { error: "assistant unavailable" });
    }
  };
}
```

```ts
// src/next/index.ts
export { createChatRoute } from "./create-chat-route.js";
export type { CreateChatRouteOpts } from "./create-chat-route.js";
export type { HelpChatEvent } from "../chat-core/types.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/next/create-chat-route.test.ts`
Expected: PASS (4 tests)

Note: confirm `createRateLimiter` returns `{ check(key) => { allowed, retryAfterSec } }` (`src/chat-server/rate-limit.ts`). If its signature differs, adapt the call — do not change the limiter.

- [ ] **Step 5: Commit**

```bash
git add src/next/ tests/unit/next/create-chat-route.test.ts
git commit -m "feat(next): createChatRoute adapts chat-core to a web Request/Response handler"
```

---

## Task 9: Ship the `daymo/next` subpath export

**Files:**
- Modify: `package.json`
- Test: `tests/unit/next/exports.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/next/exports.test.ts
import { describe, it, expect } from "vitest";
import * as next from "../../../src/next/index.js";

describe("daymo/next entrypoint", () => {
  it("exports createChatRoute", () => {
    expect(typeof next.createChatRoute).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/next/exports.test.ts`
Expected: PASS if Task 8 is in place (this pins the entrypoint). If the import path is wrong, FAIL — fix the path.

- [ ] **Step 3: Add the subpath export to `package.json`**

Add an `exports` map (the package currently has only `bin`). Keep `bin` as-is:

```jsonc
{
  "exports": {
    ".": "./dist/index.js",
    "./next": "./dist/next/index.js"
  }
}
```

If `./dist/index.js` does not exist yet, create `src/index.ts` re-exporting the public surface:

```ts
// src/index.ts
export * as next from "./next/index.js";
export type { IndexFile, ChatResponse, Part } from "./types.js";
```

- [ ] **Step 4: Build and verify the compiled entrypoint resolves**

Run: `npx tsc && node -e "import('./dist/next/index.js').then(m => { if (typeof m.createChatRoute !== 'function') throw new Error('missing export'); console.log('ok'); })"`
Expected: prints `ok`

- [ ] **Step 5: Commit**

```bash
git add package.json src/index.ts tests/unit/next/exports.test.ts
git commit -m "feat(pkg): expose daymo/next subpath export"
```

---

## Self-review notes (addressed)

- **Spec coverage:** embedder-model configurability (Task 2), `videoBaseUrl` (Tasks 1, 6), single-tenant core (Tasks 3–6), embedding-model guard (Task 5, wired in Task 8), `onEvent` (Tasks 3, 6, 8), `daymo/next` factory with body cap + IP rate limit, no origin allowlist (Task 8), package export (Task 9), legacy server preserved (Task 7). The `manifest.json`, R2 upload, `<HelpCenter>`, and typenote/CI items are intentionally in Plans A2/A3/B.
- **Type consistency:** `LoadedIndex`, `CoreInput`, `CoreDeps`, `CoreResult`, `HelpChatEvent`, `RewriteQueryFn`, `AnswerFn` defined once in Task 3 and reused verbatim in Tasks 4–8. `answerChat(input, deps)` signature is identical across Tasks 6, 7, 8.
- **Verification:** every implementation step is preceded by a failing test and followed by a run command with expected output.
