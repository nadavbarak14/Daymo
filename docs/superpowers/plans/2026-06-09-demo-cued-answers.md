# Demo-Cued Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sliced clip-stub chat answers with whole-demo cards cued to the relevant step; give the model a visual-first answer policy with model-driven retrieval; make meta questions answerable.

**Architecture:** No wire-schema change (`ChatResponse`/`VideoPart` stay identical). `VideoPart` is reinterpreted as a *cue reference*. Server side: the query-rewrite pass becomes always-on/multi-query/catalog-aware, the 0.35 cosine gate becomes a prompt signal, and the answer prompt is rewritten. Client side: both renderers group same-demo video parts into one card; the help-center theater plays through with referenced steps highlighted; the widget lightbox soft-pauses once at the end of the referenced range.

**Tech Stack:** TypeScript, Vitest, Vercel AI SDK (`generateObject`, Gemini), zero-dependency DOM rendering (help-center + widget), JSON locale bundles.

**Spec:** `docs/superpowers/specs/2026-06-09-demo-cued-answers-design.md`

**Key fact the spec glosses:** there are TWO retrieval paths with duplicated logic — `src/chat-core/answer-chat.ts` (help-center Next route) and `src/chat-server/handlers/chat.ts` (standalone widget chat server). Both get the same flow change (Tasks 5 and 6). The prompt/LLM changes in `src/chat-server/llm.ts` are shared by both automatically.

**Conventions:**
- Run unit tests with `npx vitest run <path>` from the repo root.
- `tests/integration/stitch-keyframes.test.ts` has a PRE-EXISTING failure (ffmpeg GOP) unrelated to this work — ignore it.
- `golden-questions.test.ts` and `embedder-gemini-real.test.ts` are LLM/network-gated; they skip without keys.
- help-center DOM code uses SINGLE template literals for `innerHTML` on purpose (SWC/Turbopack constant-folding bug drops `+`-concatenated operands — see comment in `src/help-center/player.ts:43`). Never split those into concatenations.

---

### Task 1: Shared types — rewrite result, answer input, event shape

**Files:**
- Modify: `src/chat-core/types.ts`
- Modify: `src/next/create-chat-route.ts` (error-path emit, ~line 86)
- Modify: `src/chat-server/handlers/chat.ts` (delete its duplicate `RewriteQueryFn`/`AnswerFn`, import shared ones)
- Modify: `src/chat-server/server.ts` (import source for the fn types, ~line 17)
- Test: `tests/unit/chat-core/types.test.ts` (exists — adjust if it asserts on these types)

- [ ] **Step 1: Update `src/chat-core/types.ts`**

Replace `RewriteQueryFn`, `AnswerFn`, and `HelpChatEvent` with:

```ts
import type { ChatResponse, IndexedChunk, IndexedDemo, IndexFile } from "../types.js";

export interface RewriteResult {
  /** 1-2 self-contained search strings (retrieval-only — never shown to the answer model as the user's message). */
  queries: string[];
  /** True for "what's available / what can I do here"-shaped questions. */
  catalogIntent: boolean;
}

export type RewriteQueryFn = (input: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  catalog: IndexedDemo[];
}) => Promise<RewriteResult>;

export type AnswerFn = (input: {
  /** The user's ORIGINAL message — language detection depends on this. */
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
  catalog: IndexedDemo[];
  retrievalConfidence: "low" | "normal";
}) => Promise<ChatResponse>;

export interface HelpChatEvent {
  requestId: string;
  question: string;
  rewrittenQueries: string[];
  outcome: "answered" | "no_match" | "error";
  matchedStepIds: string[];
  topCosine: number;
  latencyMs: number;
}
```

Also add `noMatchText: string;` to `LoadedIndex` (used in Task 5).

- [ ] **Step 2: Point the duplicates at the shared types**

In `src/chat-server/handlers/chat.ts`, delete the local `RewriteQueryFn` and `AnswerFn` declarations (lines 11–21) and add:

```ts
import type { RewriteQueryFn, AnswerFn } from "../../chat-core/types.js";
export type { RewriteQueryFn, AnswerFn };
```

(The re-export keeps `src/chat-server/server.ts:17` and `src/commands/serve.ts` imports working — verify where they import from and adjust if they import from `./handlers/chat.js`.)

In `src/next/create-chat-route.ts` error path (~line 86), change `rewrittenQuery: ""` to `rewrittenQueries: []`.

- [ ] **Step 3: Compile to find every breakage**

Run: `npx tsc --noEmit`
Expected: errors in `src/chat-core/answer-chat.ts`, `src/chat-server/handlers/chat.ts`, `src/next/gemini-deps.ts`, `src/chat-server/llm.ts`, and tests — these are fixed in Tasks 3–6. Do NOT fix them all now; just confirm the error list matches those files (no surprises elsewhere). If `tests/unit/chat-core/types.test.ts` asserts on the old shapes, update it to the new shapes now.

- [ ] **Step 4: Commit**

```bash
git add src/chat-core/types.ts src/next/create-chat-route.ts src/chat-server/handlers/chat.ts src/chat-server/server.ts tests/unit/chat-core/types.test.ts
git commit -m "feat(chat): multi-query rewrite + catalog types, rewrittenQueries event shape"
```

(It's fine that the tree doesn't compile until Task 6 — tasks 1–6 land as one arc; if you prefer green commits, squash Tasks 1–6 into per-file commits at the end of Task 6 instead.)

---

### Task 2: Server shape rules — `clampParts` keeps text; validation drops the consecutive-videos rule

**Files:**
- Modify: `src/chat-server/llm.ts:72-85`
- Modify: `src/chat-server/validate-response.ts:22-39`
- Test: `tests/unit/clamp-parts.test.ts` (create)
- Test: `tests/unit/validate-response.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/clamp-parts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clampParts } from "../../src/chat-server/llm.js";
import type { Part, TextPart, VideoPart } from "../../src/types.js";

const t = (s: string): TextPart => ({ kind: "text", text: s });
const v = (n: number): VideoPart => ({
  kind: "video", stepId: `d:0:${n}`, demoId: "d",
  startMs: n * 100, endMs: n * 100 + 50, caption: `c${n}`, mp4Url: "",
});

describe("clampParts", () => {
  it("keeps text parts that follow the 3rd video (the 'other demos' mention)", () => {
    const parts: Part[] = [t("a"), v(1), v(2), v(3), t("also see X and Y"), v(4)];
    const out = clampParts(parts);
    expect(out).toEqual([t("a"), v(1), v(2), v(3), t("also see X and Y")]);
  });

  it("never exceeds 6 total parts", () => {
    const parts: Part[] = [t("1"), t("2"), t("3"), t("4"), t("5"), t("6"), t("7")];
    expect(clampParts(parts)).toHaveLength(6);
  });

  it("passes through a compliant answer untouched", () => {
    const parts: Part[] = [t("a"), v(1), t("b"), v(2)];
    expect(clampParts(parts)).toEqual(parts);
  });
});
```

In `tests/unit/validate-response.test.ts`: DELETE the test `"downgrades when two consecutive parts are videos"` (lines 49–55) and ADD:

```ts
  it("passes consecutive videos and repeated demoIds (renderer collapses them)", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "", mp4Url: "" },
      { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 2000, endMs: 3000, caption: "", mp4Url: "" },
    ]};
    expect(validateChatResponse(resp, stepLookup).ok).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/clamp-parts.test.ts tests/unit/validate-response.test.ts`
Expected: clamp-parts FAILS (`clampParts` not exported); the new validate test FAILS ("two consecutive video parts").

- [ ] **Step 3: Implement**

In `src/chat-server/llm.ts`, replace `clampParts` (lines 74–85) with an exported version:

```ts
const MAX_PARTS = 6;

/** Enforce the product shape (≤3 videos, ≤6 parts) WITHOUT dropping text:
 *  a >3-demos answer is told to name the overflow demos in text, and that
 *  text must survive the clamp. Excess videos are dropped in place; if the
 *  result still exceeds 6 parts, trailing parts go. */
export function clampParts(parts: Part[]): Part[] {
  let videos = 0;
  const out = parts.filter((p) => p.kind !== "video" || ++videos <= MAX_VIDEO_PARTS);
  return out.slice(0, MAX_PARTS);
}
```

In `src/chat-server/validate-response.ts`, delete the consecutive-videos check (lines 27–29):

```ts
      if (i > 0 && parts[i - 1].kind === "video") {
        return { ok: false, reason: `two consecutive video parts at index ${i}` };
      }
```

Everything else (unknown stepId, timestamp mismatch, demoId mismatch, MAX_PARTS, MAX_VIDEO_PARTS) stays.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/clamp-parts.test.ts tests/unit/validate-response.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/llm.ts src/chat-server/validate-response.ts tests/unit/clamp-parts.test.ts tests/unit/validate-response.test.ts
git commit -m "feat(chat): clampParts preserves text; allow consecutive/same-demo video parts"
```

---

### Task 3: Multi-query, catalog-aware `rewriteQuery`

**Files:**
- Modify: `src/chat-server/llm.ts:13-38`
- Modify: `src/next/gemini-deps.ts:50`
- Test: `tests/unit/rewrite-query.test.ts` (create — tests the trim/fallback logic around the mocked AI SDK)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/rewrite-query.test.ts`. Mock the AI SDK so no network is hit:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
  generateText: vi.fn(),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => "model-stub",
}));

import { rewriteQuery } from "../../src/chat-server/llm.js";

const input = {
  message: "how do I share it?",
  history: [{ role: "user" as const, content: "how do I create a course" }],
  catalog: [{ demoId: "share", title: "Share a course", description: "Invite students", durationMs: 60000 }],
};

describe("rewriteQuery", () => {
  beforeEach(() => generateObject.mockReset());

  it("returns trimmed queries and the catalogIntent flag", async () => {
    generateObject.mockResolvedValue({ object: { queries: ['  "share a course"  '], catalogIntent: false } });
    const out = await rewriteQuery(input, { apiKey: "k" });
    expect(out).toEqual({ queries: ["share a course"], catalogIntent: false });
  });

  it("includes the catalog in the system prompt", async () => {
    generateObject.mockResolvedValue({ object: { queries: ["x"], catalogIntent: true } });
    await rewriteQuery(input, { apiKey: "k" });
    const call = generateObject.mock.calls[0][0] as { system: string };
    expect(call.system).toContain("Share a course");
  });

  it("fails open to the raw message on LLM error", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    const out = await rewriteQuery(input, { apiKey: "k" });
    expect(out).toEqual({ queries: ["how do I share it?"], catalogIntent: false });
  });

  it("fails open when the model returns only empty strings", async () => {
    generateObject.mockResolvedValue({ object: { queries: ['""'], catalogIntent: false } });
    const out = await rewriteQuery(input, { apiKey: "k" });
    expect(out.queries).toEqual(["how do I share it?"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/rewrite-query.test.ts`
Expected: FAIL (old `rewriteQuery` returns a string, takes no catalog).

- [ ] **Step 3: Implement in `src/chat-server/llm.ts`**

Replace `REWRITE_SYSTEM`, `RewriteQueryInput`, and `rewriteQuery` (lines 13–38) with:

```ts
import type { IndexedChunk, IndexedDemo, ChatResponse, Part } from "../types.js";
import type { RewriteResult } from "../chat-core/types.js";

function renderCatalog(catalog: IndexedDemo[]): string {
  if (catalog.length === 0) return "(no demos published)";
  return catalog
    .map((d) => `- ${d.demoId}: ${d.title} — ${d.description}`)
    .join("\n");
}

function rewriteSystem(catalog: IndexedDemo[]): string {
  return `You turn the user's latest message into search queries over a library of product demo videos.

Output:
- queries: 1-2 self-contained search strings capturing the user's full intent. Resolve pronouns and follow-ups from the conversation ("how do I share it?" after a course question → "share a course"). One focused question → ONE query. A question spanning two distinct topics → TWO queries. Each <=30 tokens, in English.
- catalogIntent: true when the user asks what's available or what they can do in general ("what can I do here?", "what are my options?", "what do you cover?") rather than how to do one specific thing.

Demo library (context for resolving what the user means):
${renderCatalog(catalog)}`;
}

const RewriteSchema = z.object({
  queries: z.array(z.string()).min(1).max(2),
  catalogIntent: z.boolean(),
});

export interface RewriteQueryInput {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  catalog: IndexedDemo[];
}

export async function rewriteQuery(input: RewriteQueryInput, opts: LlmOpts): Promise<RewriteResult> {
  const google = createGoogleGenerativeAI({ apiKey: opts.apiKey });
  const historyText = input.history.map((t) => `${t.role}: ${t.content}`).join("\n");
  const userBlock = [
    historyText ? `Conversation so far:\n${historyText}\n` : "",
    `Latest message: ${input.message}`,
  ].join("\n");

  try {
    const { object } = await generateObject({
      model: google(REWRITE_MODEL),
      schema: RewriteSchema,
      system: rewriteSystem(input.catalog),
      prompt: userBlock,
      maxTokens: 200,
      temperature: 0.0,
    });
    const queries = object.queries
      .map((q) => q.trim().replace(/^["'`]+|["'`]+$/g, "").trim())
      .filter(Boolean);
    if (queries.length === 0) return { queries: [input.message], catalogIntent: false };
    return { queries, catalogIntent: object.catalogIntent };
  } catch {
    // Fail open: retrieval falls back to the raw message; never block the answer.
    return { queries: [input.message], catalogIntent: false };
  }
}
```

Delete the now-unused `generateText` import if nothing else uses it. `src/next/gemini-deps.ts:50` (`rewriteQuery: (input) => geminiRewriteQuery(input, ...)`) compiles unchanged because the input/output types flow through.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/rewrite-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/llm.ts src/next/gemini-deps.ts tests/unit/rewrite-query.test.ts
git commit -m "feat(chat): always-on multi-query rewrite with catalog context and intent flag"
```

---

### Task 4: New answer prompt — visual-first, catalog-grounded, cue semantics

**Files:**
- Modify: `src/chat-server/llm.ts:87-163` (`answerSystem`, `AnswerWithChunksInput`, `answerWithChunks`)
- Test: `tests/unit/answer-with-chunks.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/answer-with-chunks.test.ts` (same AI SDK mock pattern as Task 3):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: () => () => "model-stub" }));

import { answerWithChunks } from "../../src/chat-server/llm.js";

const base = {
  query: "¿cómo creo un curso?",
  history: [],
  chunks: [{
    stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1,
    globalStartMs: 100, globalEndMs: 900, text: "create a course",
    embedding: [], keywords: [],
  }],
  locale: "en",
  catalog: [{ demoId: "d", title: "Create a course", description: "From the dashboard", durationMs: 79000 }],
  retrievalConfidence: "normal" as const,
};

describe("answerWithChunks", () => {
  beforeEach(() => generateObject.mockReset());

  it("sends the catalog and confidence signal in the prompt, and the ORIGINAL message as the user line", async () => {
    generateObject.mockResolvedValue({ object: { kind: "answer", parts: [{ kind: "text", text: "ok" }] } });
    await answerWithChunks(base, { apiKey: "k" });
    const call = generateObject.mock.calls[0][0] as { system: string; prompt: string };
    expect(call.system).toContain("Showing beats telling");
    expect(call.prompt).toContain("Create a course");           // catalog
    expect(call.prompt).toContain("Retrieval confidence: normal");
    expect(call.prompt).toContain("¿cómo creo un curso?");      // original message, not a rewrite
  });

  it("clamps answer parts", async () => {
    const v = (n: number) => ({ kind: "video", stepId: `d:0:${n}`, demoId: "d", startMs: 0, endMs: 1, caption: "", mp4Url: "" });
    generateObject.mockResolvedValue({ object: { kind: "answer", parts: [v(1), v(2), v(3), v(4), { kind: "text", text: "tail" }] } });
    const out = await answerWithChunks(base, { apiKey: "k" });
    if (out.kind !== "answer") throw new Error("expected answer");
    expect(out.parts.filter((p) => p.kind === "video")).toHaveLength(3);
    expect(out.parts.at(-1)).toEqual({ kind: "text", text: "tail" });
  });

  it("returns the empty-text no_match marker on LLM failure", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    const out = await answerWithChunks(base, { apiKey: "k" });
    expect(out).toEqual({ kind: "no_match", text: "" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/answer-with-chunks.test.ts`
Expected: FAIL (old input type, old prompt, hardcoded catch text).

- [ ] **Step 3: Implement in `src/chat-server/llm.ts`**

Replace `answerSystem` (lines 87–110) with:

```ts
function answerSystem(locale: string): string {
  return `You answer product questions using the demo library and the retrieved demo chunks below.

SHOWING BEATS TELLING — your strong default is to attach video:
- A video part means "open this demo, cued to this step" — the user gets the WHOLE demo, scrubbable, with the referenced steps highlighted. It is NOT a short clip.
- When a demo covers what the user asked, attach it cued to the relevant step instead of describing UI in words ("press the button at the top" is worse than showing it).
- You decide per question. Reference multiple steps of one demo (one video part per step — the UI collapses them into one card) when the answer spans steps; reference up to 3 different demos when the answer genuinely spans demos, with text bridging them.
- If more than 3 demos are relevant, attach the 3 most relevant and name the others in a text part BEFORE the last video part.
- Text-only answers are for conceptual or catalog-level questions where no single demo moment helps.

CAPTIONS — each video part's caption is one short sentence (~15 words) saying what that step shows; it renders as a sub-line on the demo card.

GROUNDING — never invent:
- Capability claims must be supported by a demo title/description in the library or by a retrieved chunk. If unsupported, say you're not sure and point to the nearest covered demo. A confident wrong "yes it supports X" is the worst possible answer.
- Do NOT name buttons, features, or steps that don't appear in any chunk.
- When "Retrieval confidence" is low, prefer catalog-level answers ("here's what I can show you…") or no_match — do not stretch weak chunks into a specific answer.

CATALOG QUESTIONS — for "what can I do here?" / "what are my options?", answer with a short text overview of the library and attach 1-3 representative demos as video parts (their first steps are in the chunks).

LANGUAGE — always reply in the language of the user's most recent message. Detect it from their words. Only fall back to "${locale}" when genuinely ambiguous.

WHEN TO ANSWER vs. no_match:
- A chunk or catalog entry is on-topic → kind="answer".
- Nothing relates → kind="no_match": name 2-3 topics the library DOES cover, plus suggestions[] with the nearest askable questions. Never a bare "rephrase that".

OUTPUT SHAPE:
- kind="answer": parts[] has 1..6 items, max 3 video parts. Multiple video parts may cite the same demo (different steps).
- kind="no_match": helpful text + suggestions[].

STRICT FIELD RULES:
- Every video.stepId MUST appear verbatim in a chunk. Never invent stepIds.
- Each video part's startMs and endMs MUST equal the chunk's globalStartMs and globalEndMs exactly.
- Always set mp4Url to "" — the server fills it.`;
}
```

Replace `AnswerWithChunksInput` and the `userBlock`/catch in `answerWithChunks`:

```ts
export interface AnswerWithChunksInput {
  /** The user's ORIGINAL message (not a rewrite) — language detection depends on it. */
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
  catalog: IndexedDemo[];
  retrievalConfidence: "low" | "normal";
}
```

```ts
  const userBlock = [
    "Demo library:",
    renderCatalog(input.catalog),
    "",
    `Retrieval confidence: ${input.retrievalConfidence}`,
    "",
    "Retrieved chunks:",
    renderChunks(input.chunks),
    "",
    "Conversation history:",
    historyText,
    "",
    `User: ${input.query}`,
  ].join("\n");
```

And the catch (line 159–162) becomes the empty-text marker the route layer replaces with its configured no-match (Task 5):

```ts
  } catch {
    // Hard LLM failure (schema mismatch / upstream error). Empty text is a
    // marker — answer-chat/handleChat substitute their configured no-match.
    return { kind: "no_match", text: "" };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/answer-with-chunks.test.ts tests/unit/clamp-parts.test.ts tests/unit/rewrite-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/llm.ts tests/unit/answer-with-chunks.test.ts
git commit -m "feat(chat): visual-first catalog-grounded answer prompt; cue semantics; empty-text failure marker"
```

---

### Task 5: `answer-chat.ts` — gate→signal, parallel multi-retrieval, catalog-intent chunks, configurable no-match

**Files:**
- Modify: `src/chat-core/answer-chat.ts` (full rewrite below)
- Modify: `src/chat-core/load-index.ts` (add `noMatchText`)
- Modify: `src/next/create-chat-route.ts` (pass-through option)
- Test: `tests/unit/chat-core/answer-chat.test.ts` (rewrite)
- Test: `tests/unit/chat-core/load-index.test.ts` (extend)

- [ ] **Step 1: Rewrite the test file `tests/unit/chat-core/answer-chat.test.ts`**

Keep the existing `index` fixture but add a demo + a second chunk so catalog-intent and union are testable. Full new file:

```ts
import { describe, it, expect, vi } from "vitest";
import { answerChat } from "../../../src/chat-core/answer-chat.js";
import { loadIndex } from "../../../src/chat-core/load-index.js";
import type { IndexFile } from "../../../src/types.js";
import type { CoreDeps, HelpChatEvent } from "../../../src/chat-core/types.js";

const index: IndexFile = {
  version: "v1",
  widgetId: "help",
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 2,
  videoBaseUrl: "https://cdn/help/v1",
  createdAt: "2026-06-04T00:00:00Z",
  etag: "sha256:x",
  demos: [
    { demoId: "d", title: "Create a note", description: "Notes basics", durationMs: 60000 },
    { demoId: "e", title: "Share a course", description: "Invite people", durationMs: 70000 },
  ],
  chunks: [
    { stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 100, globalEndMs: 900,
      text: "create a note", embedding: [1, 0], keywords: ["create", "note"] },
    { stepId: "e:0:1", demoId: "e", sceneIndex: 0, stepIndex: 1, globalStartMs: 0, globalEndMs: 500,
      text: "share a course", embedding: [0, 1], keywords: ["share", "course"] },
  ],
};

function deps(over: Partial<CoreDeps> = {}): CoreDeps {
  return {
    loaded: loadIndex(index, { suggestedQuestions: ["How do I create a note?"], defaultLocale: "en" }),
    embedQuery: async () => [1, 0],
    rewriteQuery: async () => ({ queries: ["create note"], catalogIntent: false }),
    answer: async () => ({
      kind: "answer",
      parts: [
        { kind: "text", text: "Here:" },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 100, endMs: 900, caption: "create", mp4Url: "" },
      ],
    }),
    ...over,
  };
}

describe("answerChat", () => {
  it("returns an answer and fills mp4Url from videoBaseUrl", async () => {
    const onEvent = vi.fn();
    const res = await answerChat({ message: "how do I create a note", history: [], requestId: "r1" }, deps({ onEvent }));
    expect(res.status).toBe(200);
    if (res.body.kind !== "answer") throw new Error("expected answer");
    const video = res.body.parts.find((p) => p.kind === "video");
    expect(video && "mp4Url" in video && video.mp4Url).toBe("https://cdn/help/v1/d/output.mp4");
    const ev = onEvent.mock.calls[0][0] as HelpChatEvent;
    expect(ev.outcome).toBe("answered");
    expect(ev.rewrittenQueries).toEqual(["create note"]);
    expect(ev.matchedStepIds).toContain("d:0:1");
  });

  it("low cosine no longer short-circuits: the answer model runs with retrievalConfidence 'low'", async () => {
    const answer = vi.fn(async () => ({ kind: "answer" as const, parts: [{ kind: "text" as const, text: "catalog overview" }] }));
    const res = await answerChat(
      { message: "unrelated", history: [], requestId: "r2" },
      deps({ embedQuery: async () => [0.5, 0.5], answer }), // mid cosine ~0.7 against both... use orthogonal-ish below threshold
    );
    expect(answer).toHaveBeenCalled();
    expect(res.body.kind).toBe("answer");
  });

  it("passes the ORIGINAL message (not the rewrite) to the answer model, plus catalog + confidence", async () => {
    const answer = vi.fn(async () => ({ kind: "answer" as const, parts: [{ kind: "text" as const, text: "ok" }] }));
    await answerChat({ message: "¿cómo lo comparto?", history: [], requestId: "r3" }, deps({ answer }));
    const arg = answer.mock.calls[0][0];
    expect(arg.query).toBe("¿cómo lo comparto?");
    expect(arg.catalog.map((d: { demoId: string }) => d.demoId)).toEqual(["d", "e"]);
    expect(["low", "normal"]).toContain(arg.retrievalConfidence);
  });

  it("catalogIntent injects each demo's first chunk so every demo is citable", async () => {
    const answer = vi.fn(async () => ({ kind: "answer" as const, parts: [{ kind: "text" as const, text: "ok" }] }));
    await answerChat(
      { message: "what can I do here?", history: [], requestId: "r4" },
      deps({ rewriteQuery: async () => ({ queries: ["product overview"], catalogIntent: true }), answer }),
    );
    const stepIds = answer.mock.calls[0][0].chunks.map((c: { stepId: string }) => c.stepId);
    expect(stepIds).toContain("d:0:1");
    expect(stepIds).toContain("e:0:1");
  });

  it("unions retrieval across rewrite queries and the raw message without duplicates", async () => {
    const embedQuery = vi.fn(async (text: string) => (text.includes("share") ? [0, 1] : [1, 0]));
    const answer = vi.fn(async () => ({ kind: "answer" as const, parts: [{ kind: "text" as const, text: "ok" }] }));
    await answerChat(
      { message: "create and share", history: [], requestId: "r5" },
      deps({ embedQuery, rewriteQuery: async () => ({ queries: ["create note", "share course"], catalogIntent: false }), answer }),
    );
    const stepIds = answer.mock.calls[0][0].chunks.map((c: { stepId: string }) => c.stepId);
    expect(new Set(stepIds).size).toBe(stepIds.length); // no dupes
    expect(stepIds).toContain("d:0:1");
    expect(stepIds).toContain("e:0:1");
  });

  it("replaces the empty-text no_match marker with the configured no-match", async () => {
    const res = await answerChat(
      { message: "x", history: [], requestId: "r6" },
      deps({ answer: async () => ({ kind: "no_match", text: "" }) }),
    );
    if (res.body.kind !== "no_match") throw new Error("expected no_match");
    expect(res.body.text).toBe("I don't have that in the demos. Try one of these:");
    expect(res.body.suggestions).toEqual(["How do I create a note?"]);
  });

  it("downgrades to no_match when the LLM returns an unknown stepId", async () => {
    const res = await answerChat(
      { message: "create", history: [], requestId: "r7" },
      deps({
        answer: async () => ({
          kind: "answer",
          parts: [
            { kind: "text", text: "see" },
            { kind: "video", stepId: "does-not-exist", demoId: "d", startMs: 0, endMs: 1, caption: "x", mp4Url: "" },
          ],
        }),
      }),
    );
    expect(res.body.kind).toBe("no_match");
  });

  it("empty index AND empty catalog → canned no_match without calling the LLM", async () => {
    const empty: IndexFile = { ...index, demos: [], chunks: [] };
    const answer = vi.fn();
    const res = await answerChat(
      { message: "anything", history: [], requestId: "r8" },
      deps({ loaded: loadIndex(empty, { suggestedQuestions: ["Try this?"], defaultLocale: "en" }), answer }),
    );
    expect(answer).not.toHaveBeenCalled();
    expect(res.body.kind).toBe("no_match");
  });

  it("caps history to the last 2 turns before rewrite", async () => {
    const rewriteQuery = vi.fn(async () => ({ queries: ["create note"], catalogIntent: false }));
    const history = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
      { role: "user" as const, content: "c" },
      { role: "assistant" as const, content: "d" },
    ];
    await answerChat({ message: "more", history, requestId: "r9" }, deps({ rewriteQuery }));
    expect(rewriteQuery.mock.calls[0][0].history).toHaveLength(2);
  });
});
```

Note on the "low cosine" test: with 2-dim embeddings, pick `embedQuery: async () => [0.2, 0.1]` style vectors if `[0.5, 0.5]` lands above 0.35 against a fixture — the assertion that matters is `answer` WAS called. Adjust the vector until `retrievalConfidence` is genuinely `"low"` (cosine of normalized vectors; `[1,0]` vs `[0.2,0.98]` ≈ 0.2 works: use `embedQuery: async () => [0.2, 0.98]` and assert `answer.mock.calls[0][0].retrievalConfidence` is `"low"`).

In `tests/unit/chat-core/load-index.test.ts`, add:

```ts
  it("defaults noMatchText and accepts an override", () => {
    const a = loadIndex(index, { suggestedQuestions: [], defaultLocale: "en" });
    expect(a.noMatchText).toBe("I don't have that in the demos. Try one of these:");
    const b = loadIndex(index, { suggestedQuestions: [], defaultLocale: "en", noMatchText: "Nada de eso." });
    expect(b.noMatchText).toBe("Nada de eso.");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/chat-core/`
Expected: FAIL (old flow, no noMatchText).

- [ ] **Step 3: Implement `src/chat-core/load-index.ts`**

```ts
export interface LoadIndexOpts {
  suggestedQuestions: string[];
  defaultLocale: string;
  /** Lead text for canned no-match responses (validation failures, hard LLM
   *  errors, empty index). Localize/brand it here. */
  noMatchText?: string;
}

export const DEFAULT_NO_MATCH_TEXT = "I don't have that in the demos. Try one of these:";
```

and in the returned object: `noMatchText: opts.noMatchText ?? DEFAULT_NO_MATCH_TEXT,`

- [ ] **Step 4: Implement `src/chat-core/answer-chat.ts`** — full new file:

```ts
import type { ChatResponse, IndexedChunk, Part, VideoPart } from "../types.js";
import { retrieve } from "../chat-server/retrieve.js";
import { extractKeywords } from "../indexer/keywords.js";
import { validateChatResponse } from "../chat-server/validate-response.js";
import type { CoreDeps, CoreInput, CoreResult, HelpChatEvent, LoadedIndex } from "./types.js";

/** Below this top-cosine the answer model is told retrieval is weak — it
 *  prefers catalog-level answers or no_match. A signal, never a gate. */
const SCORE_THRESHOLD = 0.35;

export async function answerChat(input: CoreInput, deps: CoreDeps): Promise<CoreResult> {
  const startedAt = performance.now();
  const { loaded } = deps;
  const locale = input.locale ?? loaded.defaultLocale;
  const history = input.history.slice(-2);
  const catalog = loaded.index.demos;

  const emit = (
    outcome: HelpChatEvent["outcome"],
    rewrittenQueries: string[],
    topCosine: number,
    stepIds: string[],
  ): void => {
    deps.onEvent?.({
      requestId: input.requestId,
      question: input.message,
      rewrittenQueries,
      outcome,
      matchedStepIds: stepIds,
      topCosine,
      latencyMs: Math.round(performance.now() - startedAt),
    });
  };

  // Nothing published → nothing to ground an answer in. Skip the LLM.
  if (loaded.index.chunks.length === 0 && catalog.length === 0) {
    emit("no_match", [], 0, []);
    return { status: 200, body: noMatch(loaded) };
  }

  // The rewrite is retrieval-only. It runs in parallel with embedding the raw
  // message so the always-on rewrite doesn't serialize the common path.
  const [rewrite, originalEmbedding] = await Promise.all([
    deps.rewriteQuery({ message: input.message, history, catalog }),
    deps.embedQuery(input.message),
  ]);
  const queries = rewrite.queries.slice(0, 2);
  const rewriteEmbeddings = await Promise.all(
    queries.map((q) => (q === input.message ? Promise.resolve(originalEmbedding) : deps.embedQuery(q))),
  );

  // Rewritten queries first (context-resolved), raw message last; union dedupes.
  const retrievals = [
    ...rewriteEmbeddings.map((embedding, i) => ({ embedding, keywords: extractKeywords(queries[i]) })),
    { embedding: originalEmbedding, keywords: extractKeywords(input.message) },
  ].map((query) => retrieve({ query, chunks: loaded.index.chunks, k: 8 }));

  const seen = new Set<string>();
  const chunks: IndexedChunk[] = [];
  outer: for (const r of retrievals) {
    for (const c of r.chunks) {
      if (chunks.length >= 8) break outer;
      if (seen.has(c.stepId)) continue;
      seen.add(c.stepId);
      chunks.push(c);
    }
  }

  // Catalog-shaped question: make every demo citable by including its first
  // step (validation requires stepIds to come from chunks). Bounded by the
  // demo count, deliberately allowed past k=8.
  if (rewrite.catalogIntent) {
    for (const c of firstChunkPerDemo(loaded.index.chunks)) {
      if (seen.has(c.stepId)) continue;
      seen.add(c.stepId);
      chunks.push(c);
    }
  }

  const topCosine = retrievals.reduce((m, r) => Math.max(m, r.topCosineScore), 0);
  const retrievalConfidence = topCosine < SCORE_THRESHOLD ? ("low" as const) : ("normal" as const);

  let response = await deps.answer({
    query: input.message,
    history,
    chunks,
    locale,
    catalog,
    retrievalConfidence,
  });

  // Empty text = the LLM layer's hard-failure marker (see answerWithChunks).
  if (response.kind === "no_match" && response.text === "") {
    emit("no_match", queries, topCosine, []);
    return { status: 200, body: noMatch(loaded) };
  }

  if (response.kind === "answer") {
    response = {
      kind: "answer",
      parts: response.parts.map((p): Part => {
        if (p.kind !== "video") return p;
        const v = p as VideoPart;
        // The model only chooses WHICH step to cite — the index is
        // authoritative for where that step lives. Models routinely fudge
        // startMs/endMs, so repair from the chunk instead of letting
        // validation refuse the whole answer over a few milliseconds.
        const chunk = loaded.stepLookup.get(v.stepId);
        if (chunk) {
          return {
            ...v,
            demoId: chunk.demoId,
            startMs: chunk.globalStartMs,
            endMs: chunk.globalEndMs,
            mp4Url: `${loaded.videoBaseUrl}/${chunk.demoId}/output.mp4`,
          };
        }
        return { ...v, mp4Url: `${loaded.videoBaseUrl}/${v.demoId}/output.mp4` };
      }),
    };
  }

  const validation = validateChatResponse(response, loaded.stepLookup);
  if (!validation.ok) {
    emit("no_match", queries, topCosine, []);
    return { status: 200, body: noMatch(loaded) };
  }

  const stepIds =
    response.kind === "answer"
      ? response.parts.filter((p): p is VideoPart => p.kind === "video").map((p) => p.stepId)
      : [];
  emit(response.kind === "answer" ? "answered" : "no_match", queries, topCosine, stepIds);
  return { status: 200, body: response };
}

function firstChunkPerDemo(chunks: IndexedChunk[]): IndexedChunk[] {
  const best = new Map<string, IndexedChunk>();
  for (const c of chunks) {
    const cur = best.get(c.demoId);
    if (!cur || c.globalStartMs < cur.globalStartMs) best.set(c.demoId, c);
  }
  return [...best.values()];
}

function noMatch(loaded: LoadedIndex): ChatResponse {
  return {
    kind: "no_match",
    text: loaded.noMatchText,
    suggestions: loaded.suggestedQuestions.slice(0, 3),
  };
}
```

In `src/next/create-chat-route.ts`, add `noMatchText?: string;` to `CreateChatRouteOpts` and pass it into `loadIndex(...)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/chat-core/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/chat-core/ src/next/create-chat-route.ts tests/unit/chat-core/
git commit -m "feat(chat): model-driven retrieval — gate becomes signal, multi-query union, catalog-intent chunks, configurable no-match"
```

---

### Task 6: Mirror the flow in the widget chat server (`handleChat`)

**Files:**
- Modify: `src/chat-server/handlers/chat.ts:44-97`
- Modify: `src/types.ts` (`WidgetConfig` += `noMatchText?: string`)
- Modify: `src/commands/serve.ts` (compiles unchanged — verify)
- Test: `tests/integration/chat-endpoint.test.ts` (update stubs/assertions)

- [ ] **Step 1: Update `handleChat`** — replace lines 44–88 mirroring Task 5's flow exactly (catalog = `entry.index.demos`, first-chunk injection, parallel embed, `break outer` union, confidence signal, empty-text marker substitution). The repair step differs only in URL building (keep `buildMp4Url`). The canned no-match becomes:

```ts
function noMatchWithSuggestions(config: { suggestedQuestions: string[]; noMatchText?: string }): ChatResponse {
  return {
    kind: "no_match",
    text: config.noMatchText ?? "I don't have that in the demos. Try one of these:",
    suggestions: config.suggestedQuestions.slice(0, 3),
  };
}
```

with call sites passing `entry.config`. Add to `WidgetConfig` in `src/types.ts`:

```ts
  /** Lead text for canned no-match responses; localize/brand per widget. */
  noMatchText?: string;
```

- [ ] **Step 2: Update `tests/integration/chat-endpoint.test.ts`**

Its stubbed `rewriteQueryFn` must return `{ queries: [...], catalogIntent: false }` and its stubbed `answerFn` accept the new input. The old "below threshold → no_match without calling answerFn" expectation inverts: answerFn IS called with `retrievalConfidence: "low"`. Read the file first; preserve its server-spinup pattern.

- [ ] **Step 3: Compile + run**

Run: `npx tsc --noEmit && npx vitest run tests/integration/chat-endpoint.test.ts tests/unit`
Expected: clean compile; tests PASS (this closes the Task 1–6 compile arc — everything server-side is green from here).

- [ ] **Step 4: Commit**

```bash
git add src/chat-server/handlers/chat.ts src/types.ts src/commands/serve.ts tests/integration/chat-endpoint.test.ts
git commit -m "feat(chat-server): widget endpoint mirrors model-driven retrieval flow"
```

---

### Task 7: Help-center grouping module

**Files:**
- Create: `src/help-center/answer-cards.ts`
- Test: `tests/unit/help-center/answer-cards.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { groupVideoParts } from "../../../src/help-center/answer-cards.js";
import type { Part } from "../../../src/types.js";

const v = (demoId: string, n: number, startMs: number, endMs: number): Part => ({
  kind: "video", stepId: `${demoId}:0:${n}`, demoId, startMs, endMs, caption: `cap${n}`, mp4Url: `/v/${demoId}.mp4`,
});

describe("groupVideoParts", () => {
  it("collapses same-demo parts into one card at the first part's index, cued at the earliest step", () => {
    const parts: Part[] = [
      { kind: "text", text: "intro" },
      v("d", 2, 2500, 3200),
      { kind: "text", text: "then" },
      v("d", 1, 1000, 1900),
      v("e", 1, 0, 700),
    ];
    const cards = groupVideoParts(parts);
    expect([...cards.keys()]).toEqual([1, 4]);          // card renders where the demo first appears
    const d = cards.get(1)!;
    expect(d.demoId).toBe("d");
    expect(d.startMs).toBe(1000);                        // earliest referenced step wins the cue
    expect(d.endMs).toBe(3200);                          // end of the referenced range
    expect(d.steps.map((s) => s.stepId)).toEqual(["d:0:2", "d:0:1"]);
    expect(cards.get(4)!.demoId).toBe("e");
  });

  it("returns one entry per demo for the single-part case", () => {
    const cards = groupVideoParts([v("d", 1, 100, 900)]);
    expect(cards.size).toBe(1);
    expect(cards.get(0)!.steps).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/unit/help-center/answer-cards.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/help-center/answer-cards.ts`**

```ts
import type { Part } from "../types.js";

export interface DemoCardRef {
  demoId: string;
  /** Index in parts[] where this demo's card renders (its first video part). */
  partIndex: number;
  /** Earliest referenced step start — the cue point. */
  startMs: number;
  /** End of the latest referenced step — the widget's soft-stop point. */
  endMs: number;
  /** Referenced steps in the order the model cited them. */
  steps: Array<{ stepId: string; startMs: number; caption: string }>;
  mp4Url: string;
}

/** Collapse an answer's video parts into one card per demo, keyed by the
 *  parts[] index where the card should render. A VideoPart is a cue
 *  reference, not a clip — N references to one demo are one card. */
export function groupVideoParts(parts: Part[]): Map<number, DemoCardRef> {
  const byDemo = new Map<string, DemoCardRef>();
  parts.forEach((p, i) => {
    if (p.kind !== "video") return;
    let ref = byDemo.get(p.demoId);
    if (!ref) {
      ref = { demoId: p.demoId, partIndex: i, startMs: p.startMs, endMs: p.endMs, steps: [], mp4Url: p.mp4Url };
      byDemo.set(p.demoId, ref);
    }
    ref.startMs = Math.min(ref.startMs, p.startMs);
    ref.endMs = Math.max(ref.endMs, p.endMs);
    ref.steps.push({ stepId: p.stepId, startMs: p.startMs, caption: p.caption });
  });
  return new Map([...byDemo.values()].map((r) => [r.partIndex, r]));
}
```

- [ ] **Step 4: Run to verify it passes**, then **commit**:

```bash
git add src/help-center/answer-cards.ts tests/unit/help-center/answer-cards.test.ts
git commit -m "feat(help-center): group answer video parts into one cue-card per demo"
```

---

### Task 8: Theater player — `referencedStepIds`, kill the clip stop

**Files:**
- Modify: `src/help-center/player.ts`
- Modify: `styles/help-center.css` (referenced-step styling)
- Test: `tests/unit/help-center/player.test.ts`

- [ ] **Step 1: Read `tests/unit/help-center/player.test.ts` and update it**

Delete/rewrite any test exercising `endMs`/clip-stop behavior (pause-at-endMs, seek-clears-clip). Add:

```ts
  it("marks referenced steps with the 'referenced' class and cues to startMs", () => {
    // open with: player.open(demo, { startMs: 2000, referencedStepIds: ["d:0:2", "d:0:3"] })
    // assert: stepsList children for those stepIds have class "referenced",
    //         others don't, and the video seek targets 2s (via the test's
    //         existing loadedmetadata/seek harness).
  });

  it("does not pause playback at the referenced range end (plays through)", () => {
    // open with referencedStepIds, advance currentTime past the last
    // referenced step via timeupdate dispatch, assert video.pause not called.
  });
```

(Write these against the file's existing fake-DOM/video harness — read it first; the comments above describe the assertions, the harness dictates the syntax.)

- [ ] **Step 2: Run to verify the new tests fail** — `npx vitest run tests/unit/help-center/player.test.ts`.

- [ ] **Step 3: Implement in `src/help-center/player.ts`**

1. `PlayerCue` becomes:

```ts
export interface PlayerCue {
  startMs?: number;
  /** Steps cited by a chat answer — rendered with a persistent "referenced"
   *  state in the timeline (distinct from the playhead-following "active"). */
  referencedStepIds?: string[];
  autoplay?: boolean;
}
```

2. Delete the clip-stop machinery: `clipEndMs` (line 66), the `seeking` listener's clear branch (lines 84–87 — the whole listener and `programmaticSeek` flag go; `seekWhenReady` loses its `programmatic` param), the `timeupdate` pause branch (lines 90–93, keep `highlightStep(ms)`), `clipEndMs = cue?.endMs ?? null` in `open()` (line 234), `clipEndMs = null` in the step-click handler (line 151) and in `close()` (line 258).

3. `buildSteps(d, referenced: Set<string>)` — add after `b.className = "daymo-help-step";`:

```ts
      if (referenced.has(s.stepId)) b.classList.add("referenced");
```

and call it from `open()` as `buildSteps(d, new Set(cue?.referencedStepIds ?? []));`.

4. `styles/help-center.css` — find the `.daymo-help-step` rules and add alongside (match the file's token conventions — `--daymo-accent` etc.):

```css
.daymo-help-step.referenced {
  box-shadow: inset 2px 0 0 var(--daymo-accent);
}
.daymo-help-step.referenced .daymo-help-step-ix {
  color: var(--daymo-accent);
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/help-center/player.test.ts`, then **commit**:

```bash
git add src/help-center/player.ts styles/help-center.css tests/unit/help-center/player.test.ts
git commit -m "feat(help-center): player highlights referenced steps; remove clip end-stop"
```

---

### Task 9: Help-center mount — demo cards, drop stepsMirror, new strings

**Files:**
- Modify: `src/help-center/mount.ts:484-563` (`renderResponse`, `renderVideoPart`→`renderDemoCard`, delete `stepsMirror`)
- Modify: `src/help-center/strings.ts`
- Modify: `styles/help-center.css` (card step-lines; remove `.daymo-help-steps-mirror*` rules)
- Test: `tests/unit/help-center/mount.test.ts`

- [ ] **Step 1: Update `src/help-center/strings.ts`**

Remove keys `clipKicker`, `clipCuedLabel`, `stepsInClip` (interface + defaults). Add:

```ts
  /** Demo-card kicker: "Full demo". Rendered as "Full demo · starts at step 3/10". */
  fullDemoLabel: string;
  /** Demo-card kicker fragment before "{n}/{m}". */
  startsAtStep: string;
```

defaults:

```ts
  fullDemoLabel: "Full demo",
  startsAtStep: "starts at step",
```

and update `composerNote` default to: `"Answers point you to the exact moment in a full walkthrough — powered by Daymo"`.

- [ ] **Step 2: Update `tests/unit/help-center/mount.test.ts`**

Read the file first; it drives `renderResponse` through a mock fetch. Update every assertion touching `.daymo-help-clip-kicker` text, `.daymo-help-clip-dur` (now full-demo duration), `stepsMirror`/`.daymo-help-steps-mirror`, and add:

```ts
  it("renders ONE card for two video parts citing the same demo, with both captions as step lines", async () => {
    // respond with parts: [text, video(d, step1), text, video(d, step2)]
    // assert: exactly one .daymo-help-clip in the answer body;
    //         its .daymo-help-clip-steps has 2 .daymo-help-clip-step-line children;
    //         no .daymo-help-steps-mirror exists.
  });

  it("opens the player with referencedStepIds and the earliest startMs, and no end stop", async () => {
    // click the card; assert openPlayer was called with
    // { startMs: <earliest>, referencedStepIds: [<both stepIds>] } — the test
    // file already stubs/observes the player; follow its pattern.
  });
```

- [ ] **Step 3: Run to verify the new/changed tests fail.**

- [ ] **Step 4: Implement in `src/help-center/mount.ts`**

1. Import: `import { groupVideoParts, type DemoCardRef } from "./answer-cards.js";`

2. In `renderResponse` (lines 484–509), replace the parts loop:

```ts
    const summary: string[] = [];
    const cited = new Set<string>();
    const cards = groupVideoParts(resp.parts);
    resp.parts.forEach((part, i) => {
      if (part.kind === "text") {
        const p = el("p", "daymo-help-a-p");
        p.textContent = part.text;
        body.appendChild(p);
        summary.push(part.text);
        return;
      }
      const ref = cards.get(i);
      if (!ref) return; // same-demo follow-up reference — collapsed into the first card
      body.appendChild(renderDemoCard(ref));
      cited.add(ref.demoId);
    });
```

Delete the `firstCited` variable and the `if (firstCited) body.appendChild(stepsMirror(firstCited));` line; delete the whole `stepsMirror` function (lines 547–563). The `related`/`followups`/`actionRow`/history lines stay as they are.

3. Replace `renderVideoPart` with `renderDemoCard` (single template literal — see Conventions):

```ts
  function renderDemoCard(ref: DemoCardRef): HTMLElement {
    const demo = demosById.get(ref.demoId);
    if (!demo) {
      // Manifest not loaded (or unknown demo): open-ended media-fragment fallback.
      const wrap = el("div", "daymo-help-clip-fallback");
      const video = doc.createElement("video");
      video.controls = true;
      video.src = `${ref.mp4Url}#t=${ref.startMs / 1000}`;
      wrap.appendChild(video);
      const caption = ref.steps[0]?.caption;
      if (caption) {
        const cap = doc.createElement("small");
        cap.textContent = caption;
        wrap.appendChild(cap);
      }
      return wrap;
    }
    const clip = el("button", "daymo-help-clip");
    (clip as HTMLButtonElement).type = "button";
    clip.innerHTML =
      `<span class="daymo-help-clip-poster"><img alt="" /><span class="daymo-help-clip-play">${ICONS.play}</span><span class="daymo-help-clip-dur"></span></span><span class="daymo-help-clip-ci"><span class="daymo-help-clip-kicker"><span class="daymo-help-dot"></span><span></span></span><span class="daymo-help-clip-cap"></span><span class="daymo-help-clip-steps"></span><span class="daymo-help-clip-cta">${ICONS.play}<span></span></span></span>`;
    sq<HTMLImageElement>(clip, "img").src = demo.posterUrl;
    sq(clip, ".daymo-help-clip-dur").textContent = formatDuration(demo.durationMs);
    const stepIx = demo.steps.findIndex((s) => s.stepId === ref.steps[0]?.stepId);
    const stepPos = stepIx >= 0
      ? stepIx + 1
      : Math.max(1, demo.steps.filter((s) => s.startMs <= ref.startMs).length);
    sq(clip, ".daymo-help-clip-kicker span:last-child").textContent =
      `${strings.fullDemoLabel} · ${strings.startsAtStep} ${stepPos}/${demo.steps.length}`;
    sq(clip, ".daymo-help-clip-cap").textContent = demo.title;
    const stepsEl = sq(clip, ".daymo-help-clip-steps");
    for (const s of ref.steps) {
      const line = el("span", "daymo-help-clip-step-line");
      line.textContent = `${formatDuration(s.startMs)} · ${s.caption}`;
      stepsEl.appendChild(line);
    }
    sq(clip, ".daymo-help-clip-cta span").textContent = strings.playLabel;
    clip.addEventListener("click", () =>
      openPlayer(demo, { startMs: ref.startMs, referencedStepIds: ref.steps.map((s) => s.stepId) }),
    );
    return clip;
  }
```

4. `styles/help-center.css`: remove the `.daymo-help-steps-mirror*` and `.daymo-help-clip-sub` rule blocks; add near the other `.daymo-help-clip-*` rules (match surrounding conventions):

```css
.daymo-help-clip-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.daymo-help-clip-step-line {
  font-size: 12.5px;
  color: var(--daymo-muted, #6b7280);
}
```

(Check what the muted-text token is actually called in this stylesheet and use that.)

- [ ] **Step 5: Run** `npx vitest run tests/unit/help-center/` → PASS, then **commit**:

```bash
git add src/help-center/mount.ts src/help-center/strings.ts styles/help-center.css tests/unit/help-center/
git commit -m "feat(help-center): one cued demo card per answer demo; drop stepsMirror and clip stubs"
```

---

### Task 10: Widget — manifest duration, grouped cards

**Files:**
- Create: `widget/src/answer-cards.ts` (copy of Task 7's module with `import type { Part } from "./types.js";` — the widget is a standalone bundle; this 30-line duplication is deliberate)
- Modify: `widget/src/manifest.ts`
- Modify: `widget/src/render-parts.ts`
- Test: `tests/unit/widget-render-parts.test.ts`, `tests/unit/widget-manifest.test.ts`, `tests/unit/widget-answer-cards.test.ts` (create — copy of Task 7's test with adjusted imports)

- [ ] **Step 1: Extend `widget/src/manifest.ts` types**

```ts
export interface ManifestDemo {
  demoId: string;
  title: string;
  videoUrl: string;
  posterUrl?: string;
  /** Full demo length — the published manifest always carries it. */
  durationMs?: number;
}
```

and `VideoSource` gains `durationMs?: number;`, with `resolveVideoSource` returning `durationMs: demo.durationMs` in the manifest branch. (`loadManifest` already stores the whole parsed object, so no parser change.) Add to `tests/unit/widget-manifest.test.ts`: a manifest demo with `durationMs: 79000` resolves to a source with `durationMs: 79000`.

- [ ] **Step 2: Rewrite `widget/src/render-parts.ts` around grouping**

New signature and behavior — one card per demo:

```ts
import type { Part } from "./types.js";
import type { VideoSource } from "./manifest.js";
import { groupVideoParts, type DemoCardRef } from "./answer-cards.js";

export function renderParts(
  root: HTMLElement,
  parts: Part[],
  onPlay: (ref: DemoCardRef, source: VideoSource) => void,
  resolveSource: (ref: DemoCardRef) => VideoSource,
  strings: { playDemo: string },
): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  const cards = groupVideoParts(parts);
  parts.forEach((part, i) => {
    if (part.kind === "text") {
      const p = document.createElement("p");
      p.textContent = part.text;
      root.appendChild(p);
      return;
    }
    const ref = cards.get(i);
    if (!ref) return; // collapsed into this demo's first card
    root.appendChild(renderDemoCard(ref, onPlay, resolveSource(ref), strings));
  });
}
```

`renderDemoCard` keeps the existing card DOM (`dw-video-card`/`dw-thumb`/`dw-play`/`dw-duration`/`dw-card-foot`) with these changes: aria-label `` `${strings.playDemo} ${source.title ?? ref.steps[0]?.caption ?? ""}` ``; duration badge `formatDuration(source.durationMs ?? ref.endMs - ref.startMs)`; no-poster fallback video src `` `${source.mp4Url}#t=${startSec}` `` (open-ended, startSec from `ref.startMs`); label text `source.title ?? ref.steps[0]?.caption ?? ""`; click → `onPlay(ref, source)`.

`resolveVideoSource` is called with `ref` now — it only uses `demoId`/`mp4Url`, which `DemoCardRef` has, so change its parameter type to `{ demoId: string; mp4Url: string }`.

- [ ] **Step 3: Update tests**

`tests/unit/widget-render-parts.test.ts`: read it; adapt call sites to the new signature (pass `strings: { playDemo: "Play demo:" }`), and add:

```ts
  it("renders one card for two parts citing the same demo", () => {
    // parts: [text, video(d, s1), video(d, s2)] → exactly one .dw-video-card
  });
  it("badges the manifest's full duration when available", () => {
    // resolveSource returns { mp4Url, durationMs: 79000 } → badge "1:19"
  });
```

- [ ] **Step 4: Run** `npx vitest run tests/unit/widget-render-parts.test.ts tests/unit/widget-manifest.test.ts tests/unit/widget-answer-cards.test.ts` → PASS after implementation, then **commit**:

```bash
git add widget/src/answer-cards.ts widget/src/manifest.ts widget/src/render-parts.ts tests/unit/widget-answer-cards.test.ts tests/unit/widget-render-parts.test.ts tests/unit/widget-manifest.test.ts
git commit -m "feat(widget): one cued demo card per answer demo; full-demo duration badge"
```

---

### Task 11: Widget lightbox — one-shot soft pause + "Keep watching" + locales

**Files:**
- Modify: `widget/src/mount.ts:87-159` (lightbox), `:301` (renderParts call site)
- Modify: `widget/src/locale.ts` (`StringBundle` += `keepWatching`, `playDemo`)
- Modify: `widget/src/locales/{en,es,fr,de,ja,pt,zh-CN,it}.json`
- Test: `tests/unit/widget-lightbox.test.ts` (create if no lightbox coverage exists — check `tests/unit/widget-*` first)

- [ ] **Step 1: Add locale keys**

`StringBundle` gains `keepWatching: string;` and `playDemo: string;`. Add to every locale file:

| file | keepWatching | playDemo |
|---|---|---|
| en.json | `"Keep watching"` | `"Play demo:"` |
| es.json | `"Seguir viendo"` | `"Reproducir demo:"` |
| fr.json | `"Continuer à regarder"` | `"Lire la démo :"` |
| de.json | `"Weiterschauen"` | `"Demo abspielen:"` |
| ja.json | `"続きを見る"` | `"デモを再生:"` |
| pt.json | `"Continuar assistindo"` | `"Reproduzir demo:"` |
| zh-CN.json | `"继续观看"` | `"播放演示："` |
| it.json | `"Continua a guardare"` | `"Riproduci demo:"` |

`tests/unit/widget-locale.test.ts` likely asserts bundle-key parity — run it; it should pass once all 8 files have both keys.

- [ ] **Step 2: Rewrite the lightbox in `widget/src/mount.ts`**

Replace the `lightboxClipEnd` state and `openLightbox`/`buildLightbox` behavior:

```ts
  let lightbox: HTMLDivElement | null = null;
  let lightboxVideo: HTMLVideoElement | null = null;
  let lightboxCaption: HTMLDivElement | null = null;
  let keepWatchingBtn: HTMLButtonElement | null = null;
  /** One-shot soft stop at the end of the referenced range (seconds).
   *  Cleared when it fires, on any user seek, and on close — NEVER sticky
   *  (the old lightboxClipEnd re-paused on every play; that was a bug). */
  let lightboxSoftStop: number | null = null;
  let lightboxProgrammaticSeek = false;
```

In `buildLightbox()`, after the video element's creation, replace the `timeupdate` listener and add seek/play handling plus the button:

```ts
    lightboxVideo.addEventListener("timeupdate", () => {
      if (lightboxSoftStop !== null && lightboxVideo!.currentTime >= lightboxSoftStop) {
        lightboxSoftStop = null; // one-shot
        lightboxVideo!.pause();
        keepWatchingBtn!.style.display = "";
      }
    });
    lightboxVideo.addEventListener("seeking", () => {
      if (lightboxProgrammaticSeek) lightboxProgrammaticSeek = false;
      else lightboxSoftStop = null; // a user seek cancels the soft stop
    });
    lightboxVideo.addEventListener("play", () => {
      keepWatchingBtn!.style.display = "none";
    });
```

and after `inner.appendChild(lightboxVideo);`:

```ts
    keepWatchingBtn = document.createElement("button");
    keepWatchingBtn.className = "dw-lb-keep";
    keepWatchingBtn.textContent = strings.keepWatching;
    keepWatchingBtn.style.display = "none";
    keepWatchingBtn.addEventListener("click", () => {
      keepWatchingBtn!.style.display = "none";
      void lightboxVideo!.play().catch(() => { /* native controls remain */ });
    });
    inner.appendChild(keepWatchingBtn);
```

`openLightbox` takes the grouped ref now:

```ts
  function openLightbox(ref: DemoCardRef, source: VideoSource): void {
    if (!lightbox) buildLightbox();
    const startSec = ref.startMs / 1000;
    lightboxSoftStop = ref.endMs / 1000;
    keepWatchingBtn!.style.display = "none";
    lightboxVideo!.src = `${source.mp4Url}#t=${startSec.toFixed(3)}`;
    if (source.posterUrl) lightboxVideo!.poster = source.posterUrl;
    lightboxCaption!.textContent = "";
    const b = document.createElement("b");
    b.textContent = source.title ?? ref.steps[0]?.caption ?? "";
    lightboxCaption!.appendChild(b);
    const caps = ref.steps.map((s) => s.caption).filter(Boolean).join(" · ");
    if (caps && source.title) lightboxCaption!.appendChild(document.createTextNode(` — ${caps}`));
    lightbox!.style.display = "flex";
    lightboxProgrammaticSeek = true;
    lightboxVideo!.currentTime = startSec;
    lightboxVideo!.play().catch(() => { /* user can press native play */ });
  }
```

`closeLightbox` additionally sets `lightboxSoftStop = null`. Update the `renderParts` call site (line ~301) to:

```ts
            renderParts(wrap, s.lastResponse.parts, openLightbox, (ref) => resolveVideoSource(ref, demos), { playDemo: strings.playDemo });
```

Add imports for `DemoCardRef` from `./answer-cards.js`. Add minimal CSS for `.dw-lb-keep` in `widget/src/styles.css` using existing `--dw-*` tokens (an accent-colored pill button centered under the video — match the file's existing button patterns, e.g. `.dw-send`).

- [ ] **Step 3: Test the soft-stop one-shot**

Create `tests/unit/widget-lightbox.test.ts` following the DOM-test pattern used by `widget-render-parts.test.ts` (jsdom; the shadow-DOM gotcha from the memory applies only to e2e, not unit). Assert: (a) timeupdate past the stop pauses once and shows `.dw-lb-keep`; (b) a subsequent play + timeupdate past the stop does NOT pause again (regression for the sticky bug); (c) user seek before the stop clears it.

- [ ] **Step 4: Run** `npx vitest run tests/unit/widget-lightbox.test.ts tests/unit/widget-locale.test.ts` → PASS, then **commit**:

```bash
git add widget/src/ tests/unit/widget-lightbox.test.ts
git commit -m "feat(widget): cue lightbox to referenced range with one-shot Keep-watching stop; fix sticky clip pause"
```

---

### Task 12: Docs, consumer note, full verification

**Files:**
- Modify: `README.md` (chat-answer behavior section + upgrade note)
- Test: full suite + build

- [ ] **Step 1: Update README**

Find the chat/help-center sections (the README documents the author→index→publish→chat workflow and a "Making it match your product" class inventory). Update: (a) answers now render one full-demo card per cited demo, cued + step-highlighted — remove any "answer clip"/`stepsInClip`/`clipKicker` class references, add `.daymo-help-clip-steps`, `.daymo-help-clip-step-line`, `.daymo-help-step.referenced`, `.dw-lb-keep`; (b) new options: `noMatchText` on `createChatRoute`/`createHelpChatRoute` and `WidgetConfig`; (c) an **Upgrading** note: "Chat answers now render one card per cited demo and open the full demo cued to the step (no clip end-stop). Consumer tests asserting on per-clip cards (e.g. typenote's `e2e/help.spec.ts`) need updating; `HelpCenterStrings` lost `clipKicker`/`clipCuedLabel`/`stepsInClip` and gained `fullDemoLabel`/`startsAtStep`; `HelpChatEvent.rewrittenQuery` became `rewrittenQueries: string[]`."

- [ ] **Step 2: Full verification**

```bash
npx tsc --noEmit
npx vitest run tests/unit
npx vitest run tests/integration/chat-endpoint.test.ts
npx tsc            # the package "prepare" build — must emit cleanly
```

Expected: all green (stitch-keyframes pre-existing failure excepted if you run the whole integration dir). If the repo has a widget build script (check `widget/package.json` / root scripts), run it too.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: demo-cued answers — upgrade notes, new strings/options, class inventory"
```

---

## Self-review notes (already folded in)

- Spec §1–§7 all map to tasks: §1→Task 4, §2→Tasks 7–9, §3→Tasks 10–11, §4→Tasks 5–6, §5→Task 2, §6→Tasks 9+11+5 (`noMatchText`), §7→every task's tests, §8→Task 12.
- Spec's "merge by max cosine" is implemented as ordered union (rewrites→raw, dedupe by stepId, cap 8) — same intent (bounded deduped set, context-resolved queries prioritized) without changing `retrieve()`'s return shape.
- Type consistency: `RewriteResult {queries, catalogIntent}`, `DemoCardRef {demoId, partIndex, startMs, endMs, steps, mp4Url}`, `PlayerCue {startMs?, referencedStepIds?, autoplay?}` are used with exactly these names across Tasks 1/3/5/7/8/9/10/11.
- Tasks 1–6 form one compile arc (tree may not compile until Task 6 Step 3); Tasks 7–11 are independently green.
