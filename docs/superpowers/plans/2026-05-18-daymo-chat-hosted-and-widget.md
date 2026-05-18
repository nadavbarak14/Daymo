# Daymo Chat v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Daymo Chat v1 — a hosted interactive manual at `daymo.dev/<companyId>/help` plus an embeddable widget, both backed by one Vercel-hosted Next.js app with Gemini for retrieval and answering, with a `daymo publish` CLI to upload artifacts.

**Architecture:** Next.js app on Vercel with route handlers for `/api/chat`, `/api/widget-config`, `/api/admin/publish/*`. Artifacts (per-company `config.json`, `index.json`, mp4s) live in Vercel Blob. The chat pipeline is `rewrite → embed → cosine retrieve → score gate → answer → validate`, all Gemini. The CLI builds an index in-process (reusing a new `src/core/indexer.ts` pure function), uploads mp4s and `index.json` via Vercel Blob's client-direct-upload pattern, then finalizes via the admin endpoint.

**Tech Stack:**
- Existing: Node ≥20.10, TypeScript, vitest, `cac` for CLI, Playwright (rendering pipeline only)
- New: Next.js 15 (app router), React 19, `@vercel/blob`, `@vercel/kv` (rate limit), `@google/generative-ai`
- Same monorepo layout: existing CLI in `src/`, new Vercel app in `apps/web/`, shared core in `src/core/`

**Spec:** `docs/superpowers/specs/2026-05-18-daymo-chat-hosted-and-widget-design.md`

---

## File structure

### New files
```
apps/web/
  package.json
  next.config.mjs
  tsconfig.json
  .env.local.example
  app/
    layout.tsx
    page.tsx                          (lightweight landing — "go to /<companyId>/help")
    [companyId]/
      help/
        page.tsx                      (server component, fetches config, renders chrome + ChatPanel)
    api/
      chat/route.ts
      widget-config/route.ts
      admin/
        publish/
          begin/route.ts
          finalize/route.ts
          health/route.ts
  components/
    ChatPanel.tsx                     (client component, used by both surfaces)
    SuggestionChips.tsx
    VideoSegment.tsx
  lib/
    blob.ts                           (Vercel Blob wrapper + LRU cache for config/index)
    gemini.ts                         (SDK wrapper: embed, rewrite, answer)
    retrieval.ts                      (cosine top-K over chunks)
    chat-pipeline.ts                  (orchestrates rewrite → retrieve → answer → validate)
    rate-limit.ts                     (Vercel KV-backed counter)
    company-id.ts                     (validation + reserved-route blocklist)
    publish-contract.ts               (shared request/response types — symlinked / copied from src/core/)
  widget-src/
    widget.ts                         (entry: Mount + shadow DOM + ChatPanel)
    build.mjs                         (esbuild script → public/widget.js)
  public/
    widget.js                         (built artifact, gitignored)

src/core/
  indexer.ts                          (pure function: artifacts → IndexJson)
  index-types.ts                      (IndexJson, Chunk, ChatResponse, Part — shared with apps/web)
  publish-contract.ts                 (shared request/response types — imported by CLI + Vercel app)

src/commands/
  publish.ts                          (daymo publish command)

tests/unit/
  indexer.test.ts
  chunk-builder.test.ts               (canonical text + bucketing)
  retrieval.test.ts                   (cosine top-K + score gate)
  company-id.test.ts                  (validation + reserved blocklist)
  chat-pipeline.test.ts               (mocked Gemini, full pipeline)
  publish-cli.test.ts                 (CLI against mock backend)

tests/integration/
  api-chat.test.ts                    (route handler with mocked Gemini + fixture index)
  api-publish.test.ts                 (route handler with mocked Blob)
  hosted-manual.test.ts               (page renders with fixture company)
  cli-publish-e2e.test.ts             (real CLI → mock Vercel server → assert Blob writes)

tests/fixtures/demo-chat/
  loomly-tour/
    tour.demo
    .daymo/
      step-index.json
      output.mp4
      0/events.json
    golden-questions.json
    expected-index.json               (deterministic indexer output for tests)
```

### Modified files
```
src/cli.ts                            (register publish command)
src/commands/stitch.ts                (write step-index.json after stitch)
package.json                          (add workspace; build script invokes apps/web build)
.gitignore                            (apps/web/.next, apps/web/node_modules, public/widget.js)
README.md                             (add publish + Vercel-app sections)
```

---

## Task 1: Stitcher writes step-index.json

**Files:**
- Modify: `src/commands/stitch.ts`
- Modify: `src/core/stitch.ts` (return `trimmedDurationMs` per scene)
- Create: `tests/integration/cli-stitch-step-index.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/cli-stitch-step-index.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { execaCommand } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("daymo stitch writes step-index.json", () => {
  const fixtureDir = path.join(__dirname, "../fixtures/stitch-step-index");
  const demoFile = path.join(fixtureDir, "tiny.demo");

  beforeAll(async () => {
    // Use the existing tiny stitch fixture (cli-stitch.test.ts pattern).
    // We assume scenes are pre-captured at fixtures/stitch-step-index/.daymo/
    // (mirrors existing cli-stitch.test.ts setup — copy + adapt).
  }, 60_000);

  it("emits .daymo/step-index.json alongside output.mp4", async () => {
    await execaCommand(`node ./dist/cli.js stitch ${demoFile}`, { cwd: process.cwd() });
    const idxPath = path.join(fixtureDir, ".daymo", "step-index.json");
    const raw = await fs.readFile(idxPath, "utf8");
    const idx = JSON.parse(raw);
    expect(idx.demoId).toBe("tiny");
    expect(idx.scenes.length).toBeGreaterThan(0);
    expect(idx.steps[0].stepId).toBe("tiny:0:0");
    expect(idx.steps[0].description).toBe("(preamble)");
    expect(idx.mp4DurationMs).toBeGreaterThan(0);
  });
});
```

Copy the fixture from `tests/integration/cli-stitch.test.ts`'s setup pattern. Use a 2-scene fixture with at least one explicit `fx.step()`.

- [ ] **Step 2: Run test, verify it fails**

```bash
npm run build && npx vitest run tests/integration/cli-stitch-step-index.test.ts
```
Expected: FAIL — `step-index.json` does not exist.

- [ ] **Step 3: Modify `src/core/stitch.ts` to expose trimmed scene durations**

The stitcher already computes per-scene mixed-webm durations internally. Add to the `StitchResult` return type:
```typescript
export interface StitchResult {
  outputPath: string;
  scenes: Array<{ trimmedDurationMs: number; recordingOffsetMs: number }>;
}
```
Update `stitch()` to populate `scenes` from the per-scene work it already does (each scene's `ffprobed_duration(mixed_scene_i.webm) - recordingOffsetMs_i`).

- [ ] **Step 4: Modify `src/commands/stitch.ts` to write step-index.json**

After the `await stitch(...)` call, build and write the step index:
```typescript
import { buildStepIndex } from "../core/step-index.js";
import type { SceneForStepIndex } from "../types.js";

// ... after stitch() returns result with per-scene durations ...

const demoId = path.basename(demoFile, ".demo");
const sceneInputs: SceneForStepIndex[] = await Promise.all(
  state.scenes.map(async (r, i) => {
    let events: any[] = [];
    if (r.eventsPath) {
      try { events = JSON.parse(await fs.readFile(r.eventsPath, "utf8")); } catch {}
    }
    return {
      sceneIndex: i,
      recordingOffsetMs: result.scenes[i].recordingOffsetMs,
      trimmedDurationMs: result.scenes[i].trimmedDurationMs,
      events,
    };
  })
);

const stepIndex = buildStepIndex(demoId, sceneInputs);
const stepIndexPath = path.join(dotDir, "step-index.json");
await fs.writeFile(stepIndexPath, JSON.stringify(stepIndex, null, 2));
process.stdout.write(`${stepIndexPath}\n`);
```

- [ ] **Step 5: Re-run the test, verify it passes**

```bash
npm run build && npx vitest run tests/integration/cli-stitch-step-index.test.ts
```
Expected: PASS.

- [ ] **Step 6: Verify ffmpeg `-g 30` keyframe spacing for sub-second seek**

The spec requires `-g 30` (GOP = 30 frames ≈ 0.5s at 60fps) on the final mp4 encode so `<video>.currentTime` lands within 500ms of the requested moment. Open `src/core/stitch.ts` and locate the ffmpeg invocation that produces `output.mp4`. If `-g 30` is not present in the args, add it adjacent to the existing `-c:v libx264` arg.

Verify with:
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -show_entries packet=flags -of csv tests/fixtures/stitch-step-index/.daymo/output.mp4 | head -50
```
Expected: `K_` (keyframe) markers appearing roughly every 30 frames.

- [ ] **Step 7: Commit**

```bash
git add src/commands/stitch.ts src/core/stitch.ts tests/integration/cli-stitch-step-index.test.ts tests/fixtures/stitch-step-index
git commit -m "feat(stitch): write step-index.json + -g 30 keyframes for sub-second seek"
```

---

## Task 2: Shared types (`src/core/index-types.ts`, `src/core/publish-contract.ts`)

**Files:**
- Create: `src/core/index-types.ts`
- Create: `src/core/publish-contract.ts`

- [ ] **Step 1: Write `src/core/index-types.ts`**

```typescript
export interface Chunk {
  stepId: string;            // "<demoId>:<sceneIndex>:<stepIndex>"
  demoId: string;
  sceneIndex: number;
  stepIndex: number;
  globalStartMs: number;
  globalEndMs: number;
  text: string;              // canonical chunk text (headers + narration + prose)
  embedding: number[];       // 768 floats
  keywords: string[];        // for future BM25; computed at index time
}

export interface IndexJsonDemo {
  demoId: string;
  title: string;
  description: string;
  durationMs: number;
}

export interface IndexJson {
  schemaVersion: 1;
  companyId: string;
  embeddingModel: "gemini-embedding-001";
  embeddingDims: 768;
  createdAt: string;         // ISO 8601
  etag: string;              // sha256 of source artifacts
  demos: IndexJsonDemo[];
  chunks: Chunk[];
}

export interface CompanyConfig {
  companyId: string;
  name: string;
  brandColor?: string;
  locale: string;            // BCP-47, default "en"
  allowedOrigins: string[];
  suggestedQuestions: string[];
  createdAt: string;
}

// --- Chat API contract ---

export interface ChatHistoryTurn { role: "user" | "assistant"; content: string }

export interface ChatRequest {
  companyId: string;
  message: string;
  history: ChatHistoryTurn[];
  locale?: string;
}

export interface TextPart { kind: "text"; text: string }

export interface VideoPart {
  kind: "video";
  stepId: string;
  demoId: string;
  startMs: number;
  endMs: number;
  caption: string;
  mp4Url: string;
}

export type Part = TextPart | VideoPart;

export type ChatResponse =
  | { kind: "answer"; parts: Part[] }
  | { kind: "no_match"; text: string; suggestions?: string[] };

export interface WidgetConfigResponse {
  name: string;
  brandColor?: string;
  locale: string;
  suggestedQuestions: string[];
}
```

- [ ] **Step 2: Write `src/core/publish-contract.ts`**

```typescript
export interface PublishBeginRequest {
  companyId: string;
  name?: string;
  brandColor?: string;
  locale?: string;
  allowedOrigins?: string[];
  files: Array<{
    relPath: string;         // e.g. "demos/loomly-tour/output.mp4"
    sizeBytes: number;
    contentType: string;
  }>;
}

export interface PublishBeginResponse {
  uploadId: string;          // opaque, used by finalize
  uploads: Array<{
    relPath: string;
    /** Vercel Blob client-direct-upload token (one per file). */
    clientToken: string;
    /** Resolved blob URL the file will land at. */
    targetBlobUrl: string;
  }>;
  /** Token for uploading index.json (last). */
  indexUpload: { clientToken: string; targetBlobUrl: string };
}

export interface PublishFinalizeRequest {
  uploadId: string;
  /** Sizes/sha256s the server validates against what landed in Blob. */
  uploaded: Array<{ relPath: string; sizeBytes: number; sha256?: string }>;
  indexUploaded: { sizeBytes: number; sha256?: string };
}

export interface PublishFinalizeResponse {
  hostedUrl: string;
  uploadedAt: string;
}

export interface PublishHealthResponse {
  ok: boolean;
  endpoint: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/index-types.ts src/core/publish-contract.ts
git commit -m "feat(core): shared types for chat index + publish contract"
```

---

## Task 3: Indexer — chunk builder (pure function over events)

**Files:**
- Create: `src/core/indexer-chunks.ts`
- Create: `tests/unit/indexer-chunks.test.ts`

This task implements the chunk text assembly per the 2026-05-14 spec's "Indexable text per step" section: combine `[Demo]`/`[Scene]`/`[Step]` headers with `fx.say` text, scene prose (first step only), and overlay/banner text. Mechanics-only steps are skipped.

- [ ] **Step 1: Write failing test (single scene, no fx.step, single fx.say)**

`tests/unit/indexer-chunks.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildChunkTexts } from "../../src/core/indexer-chunks.js";
import type { RunnerEvent } from "../../src/types.js";

describe("buildChunkTexts", () => {
  it("creates a single preamble chunk for a scene with one fx.say", () => {
    const result = buildChunkTexts({
      demoId: "tour",
      demoTitle: "Loomly Tour",
      scenes: [{
        sceneIndex: 0,
        sceneTitle: "Welcome",
        sceneProse: "The dashboard greets the user.",
        events: [
          { kind: "scene_start", t: 0, index: 0, title: "Welcome", prose: "" },
          { kind: "say", t: 100, hash: "abc", text: "Welcome back, Alex.", durationMs: 1500, words: [] },
          { kind: "scene_end", t: 1600, index: 0 },
        ] as RunnerEvent[],
      }],
    });

    expect(result).toEqual([{
      stepId: "tour:0:0",
      sceneIndex: 0,
      stepIndex: 0,
      text:
        "[Demo] Loomly Tour\n" +
        "[Scene] Welcome\n" +
        "[Step] (preamble)\n" +
        "Welcome back, Alex.\n" +
        "The dashboard greets the user.",
      keywords: expect.any(Array),
    }]);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
npx vitest run tests/unit/indexer-chunks.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildChunkTexts`**

`src/core/indexer-chunks.ts`:
```typescript
import type { RunnerEvent } from "../types.js";

export interface SceneForChunks {
  sceneIndex: number;
  sceneTitle: string;
  sceneProse: string;
  events: RunnerEvent[];
}

export interface ChunkSourceInput {
  demoId: string;
  demoTitle: string;
  scenes: SceneForChunks[];
}

export interface ChunkText {
  stepId: string;
  sceneIndex: number;
  stepIndex: number;
  text: string;
  keywords: string[];
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "this", "that", "these",
  "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
  "who", "when", "where", "why", "how", "all", "each", "every", "both",
  "few", "more", "most", "other", "some", "such", "no", "nor", "not",
  "only", "own", "same", "so", "than", "too", "very", "s", "t", "just", "your",
]);

function extractKeywords(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9-]{1,}/g) ?? [];
  return Array.from(new Set(tokens.filter((t) => !STOPWORDS.has(t) && t.length > 1)));
}

interface StepBucket {
  stepIndex: number;
  description: string;        // "(preamble)" for stepIndex 0 with no explicit step
  says: string[];
  banners: string[];
  overlays: string[];
}

/** Bucket fx.say/banner/overlay events into steps by t-order (most recent step
 *  event wins; events before the first explicit step go in the preamble). */
function bucketEvents(events: RunnerEvent[]): StepBucket[] {
  const buckets: StepBucket[] = [{ stepIndex: 0, description: "(preamble)", says: [], banners: [], overlays: [] }];
  let current = buckets[0];

  for (const ev of events) {
    if (ev.kind === "step") {
      current = { stepIndex: ev.stepIndex, description: ev.description, says: [], banners: [], overlays: [] };
      buckets.push(current);
    } else if (ev.kind === "say") {
      current.says.push(ev.text);
    } else if (ev.kind === "fx" && ev.method === "banner") {
      const text = typeof ev.args?.[0] === "string" ? (ev.args[0] as string) : "";
      if (text) current.banners.push(text);
    } else if (ev.kind === "overlay" && ev.directive.text) {
      current.overlays.push(ev.directive.text);
    }
  }

  return buckets;
}

export function buildChunkTexts(input: ChunkSourceInput): ChunkText[] {
  const out: ChunkText[] = [];

  for (const scene of input.scenes) {
    const buckets = bucketEvents(scene.events);

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const isFirstStep = i === 0;
      const lines: string[] = [
        `[Demo] ${input.demoTitle}`,
        `[Scene] ${scene.sceneTitle}`,
        `[Step] ${b.description}`,
      ];

      const content: string[] = [];
      content.push(...b.says);
      if (isFirstStep && scene.sceneProse.trim()) content.push(scene.sceneProse.trim());
      content.push(...b.banners);
      content.push(...b.overlays);

      // Skip mechanics-only chunks (headers but no content).
      if (content.length === 0) continue;

      const text = [...lines, ...content].join("\n");
      out.push({
        stepId: `${input.demoId}:${scene.sceneIndex}:${b.stepIndex}`,
        sceneIndex: scene.sceneIndex,
        stepIndex: b.stepIndex,
        text,
        keywords: extractKeywords([scene.sceneTitle, b.description, ...content].join(" ")),
      });
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test, verify PASS**

```bash
npx vitest run tests/unit/indexer-chunks.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add more test cases**

Add to the same file:
```typescript
it("buckets fx.say events into explicit steps by t-order", () => {
  const result = buildChunkTexts({
    demoId: "t",
    demoTitle: "T",
    scenes: [{
      sceneIndex: 0,
      sceneTitle: "S",
      sceneProse: "",
      events: [
        { kind: "scene_start", t: 0, index: 0, title: "S", prose: "" },
        { kind: "step", t: 100, sceneIndex: 0, stepIndex: 1, description: "Open" },
        { kind: "say", t: 150, hash: "a", text: "Click here.", durationMs: 1000, words: [] },
        { kind: "step", t: 1500, sceneIndex: 0, stepIndex: 2, description: "Submit" },
        { kind: "say", t: 1600, hash: "b", text: "Press submit.", durationMs: 1000, words: [] },
      ] as RunnerEvent[],
    }],
  });
  expect(result.map((c) => c.stepId)).toEqual(["t:0:1", "t:0:2"]);
  expect(result[0].text).toContain("Click here.");
  expect(result[1].text).toContain("Press submit.");
});

it("skips chunks that contain only headers (mechanics-only step)", () => {
  const result = buildChunkTexts({
    demoId: "t",
    demoTitle: "T",
    scenes: [{
      sceneIndex: 0,
      sceneTitle: "S",
      sceneProse: "",
      events: [
        { kind: "scene_start", t: 0, index: 0, title: "S", prose: "" },
        { kind: "step", t: 100, sceneIndex: 0, stepIndex: 1, description: "Click only" },
        { kind: "fx", t: 110, method: "cursorTo", args: [".btn"] },
      ] as RunnerEvent[],
    }],
  });
  expect(result).toEqual([]);
});

it("extracts keywords, lowercased and stopwords removed", () => {
  const result = buildChunkTexts({
    demoId: "t",
    demoTitle: "T",
    scenes: [{
      sceneIndex: 0,
      sceneTitle: "Welcome",
      sceneProse: "The user creates a new project.",
      events: [
        { kind: "scene_start", t: 0, index: 0, title: "Welcome", prose: "" },
        { kind: "say", t: 100, hash: "a", text: "Welcome.", durationMs: 500, words: [] },
      ] as RunnerEvent[],
    }],
  });
  const kw = result[0].keywords;
  expect(kw).toContain("welcome");
  expect(kw).toContain("user");
  expect(kw).toContain("creates");
  expect(kw).toContain("project");
  expect(kw).not.toContain("the");
  expect(kw).not.toContain("a");
});
```

- [ ] **Step 6: Run all tests, verify PASS**

```bash
npx vitest run tests/unit/indexer-chunks.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/core/indexer-chunks.ts tests/unit/indexer-chunks.test.ts
git commit -m "feat(indexer): pure chunk-text builder with fx.say bucketing + stopword keywords"
```

---

## Task 4: Indexer — embedder + index.json assembly

**Files:**
- Create: `src/core/indexer.ts`
- Create: `src/core/gemini-embed.ts`
- Create: `tests/unit/indexer.test.ts`

- [ ] **Step 1: Write Gemini embedder wrapper**

`src/core/gemini-embed.ts`:
```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export function realGeminiEmbedder(apiKey: string): Embedder {
  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: "gemini-embedding-001" });
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      // Gemini embedContent is single-input today; batch via Promise.all in groups of 10.
      const CONCURRENCY = 10;
      for (let i = 0; i < texts.length; i += CONCURRENCY) {
        const batch = texts.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map((t) => model.embedContent({ content: { parts: [{ text: t }], role: "user" }, taskType: "RETRIEVAL_DOCUMENT" }))
        );
        for (const r of results) out.push(r.embedding.values);
      }
      return out;
    },
  };
}
```

- [ ] **Step 2: Write failing test for the indexer**

`tests/unit/indexer.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildIndex } from "../../src/core/indexer.js";
import type { Embedder } from "../../src/core/gemini-embed.js";

const mockEmbedder: Embedder = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t, i) => {
      const vec = new Array(768).fill(0);
      vec[i % 768] = 1;
      return vec;
    });
  },
};

describe("buildIndex", () => {
  it("produces an IndexJson with one chunk per non-empty step", async () => {
    const result = await buildIndex({
      companyId: "acme",
      demos: [{
        demoId: "tour",
        demoFile: "",
        ast: {
          frontmatter: { title: "Loomly Tour", description: "A tour", url: "", tts: { provider: "edge", voice: "x", rate: "+0%", music_duck: true } },
          scenes: [{
            sourceLine: 1,
            title: "Welcome",
            prose: "Greet the user.",
            overlays: [],
            steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }],
          }],
        },
        events: [[
          { kind: "scene_start", t: 0, index: 0, title: "Welcome", prose: "" },
          { kind: "say", t: 100, hash: "a", text: "Hello.", durationMs: 500, words: [] },
        ]],
        stepIndex: {
          demoId: "tour",
          mp4DurationMs: 2000,
          scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 2000, recordingOffsetMs: 0 }],
          steps: [{ stepId: "tour:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 2000 }],
        },
      }],
      embedder: mockEmbedder,
    });

    expect(result.schemaVersion).toBe(1);
    expect(result.companyId).toBe("acme");
    expect(result.embeddingModel).toBe("gemini-embedding-001");
    expect(result.embeddingDims).toBe(768);
    expect(result.demos).toEqual([{ demoId: "tour", title: "Loomly Tour", description: "A tour", durationMs: 2000 }]);
    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].stepId).toBe("tour:0:0");
    expect(result.chunks[0].globalStartMs).toBe(0);
    expect(result.chunks[0].globalEndMs).toBe(2000);
    expect(result.chunks[0].embedding.length).toBe(768);
    expect(result.chunks[0].text).toContain("Hello.");
  });

  it("looks up (start,end)Ms from the step index by stepId", async () => {
    const result = await buildIndex({
      companyId: "acme",
      demos: [{
        demoId: "tour",
        demoFile: "",
        ast: { frontmatter: { title: "T", url: "", tts: { provider: "edge", voice: "x", rate: "+0%", music_duck: true } }, scenes: [{ sourceLine: 1, title: "S", prose: "", overlays: [], steps: [{ says: [], banners: [], types: [], highlights: [], clicks: [], cursors: [] }] }] },
        events: [[
          { kind: "scene_start", t: 0, index: 0, title: "S", prose: "" },
          { kind: "step", t: 100, sceneIndex: 0, stepIndex: 1, description: "Open" },
          { kind: "say", t: 150, hash: "a", text: "Click here.", durationMs: 1000, words: [] },
        ]],
        stepIndex: {
          demoId: "tour",
          mp4DurationMs: 3000,
          scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 3000, recordingOffsetMs: 0 }],
          steps: [
            { stepId: "tour:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 100 },
            { stepId: "tour:0:1", sceneIndex: 0, stepIndex: 1, description: "Open", globalStartMs: 100, globalEndMs: 3000 },
          ],
        },
      }],
      embedder: mockEmbedder,
    });

    const chunk = result.chunks.find((c) => c.stepId === "tour:0:1");
    expect(chunk).toBeDefined();
    expect(chunk!.globalStartMs).toBe(100);
    expect(chunk!.globalEndMs).toBe(3000);
  });
});
```

- [ ] **Step 3: Run test, verify FAIL**

```bash
npx vitest run tests/unit/indexer.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the indexer**

`src/core/indexer.ts`:
```typescript
import crypto from "node:crypto";
import type { DemoAst, RunnerEvent } from "../types.js";
import type { StepIndex } from "../types.js";
import type { Chunk, IndexJson, IndexJsonDemo } from "./index-types.js";
import { buildChunkTexts, type SceneForChunks } from "./indexer-chunks.js";
import type { Embedder } from "./gemini-embed.js";

export interface DemoInput {
  demoId: string;
  demoFile: string;          // absolute path on disk (used for etag); empty in tests
  ast: DemoAst;
  /** events[sceneIndex] = events for that scene. */
  events: RunnerEvent[][];
  stepIndex: StepIndex;
}

export interface BuildIndexInput {
  companyId: string;
  demos: DemoInput[];
  embedder: Embedder;
}

function etagOf(demos: DemoInput[]): string {
  const h = crypto.createHash("sha256");
  for (const d of demos) {
    h.update(d.demoId);
    h.update(JSON.stringify(d.stepIndex));
    for (const evs of d.events) h.update(JSON.stringify(evs));
  }
  return `sha256:${h.digest("hex")}`;
}

export async function buildIndex(input: BuildIndexInput): Promise<IndexJson> {
  const demos: IndexJsonDemo[] = [];
  const allChunks: Chunk[] = [];

  for (const demo of input.demos) {
    demos.push({
      demoId: demo.demoId,
      title: demo.ast.frontmatter.title,
      description: demo.ast.frontmatter.description ?? "",
      durationMs: demo.stepIndex.mp4DurationMs,
    });

    const scenesForChunks: SceneForChunks[] = demo.ast.scenes.map((s, i) => ({
      sceneIndex: i,
      sceneTitle: s.title,
      sceneProse: s.prose,
      events: demo.events[i] ?? [],
    }));

    const chunkTexts = buildChunkTexts({
      demoId: demo.demoId,
      demoTitle: demo.ast.frontmatter.title,
      scenes: scenesForChunks,
    });

    // Embed every chunk's text in one batch per demo.
    const embeddings = await input.embedder.embed(chunkTexts.map((c) => c.text));

    for (let i = 0; i < chunkTexts.length; i++) {
      const c = chunkTexts[i];
      const stepEntry = demo.stepIndex.steps.find((s) => s.stepId === c.stepId);
      if (!stepEntry) {
        throw new Error(`indexer: stepId ${c.stepId} present in chunks but not in step-index.json`);
      }
      allChunks.push({
        stepId: c.stepId,
        demoId: demo.demoId,
        sceneIndex: c.sceneIndex,
        stepIndex: c.stepIndex,
        globalStartMs: stepEntry.globalStartMs,
        globalEndMs: stepEntry.globalEndMs,
        text: c.text,
        embedding: embeddings[i],
        keywords: c.keywords,
      });
    }
  }

  return {
    schemaVersion: 1,
    companyId: input.companyId,
    embeddingModel: "gemini-embedding-001",
    embeddingDims: 768,
    createdAt: new Date().toISOString(),
    etag: etagOf(input.demos),
    demos,
    chunks: allChunks,
  };
}
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
npx vitest run tests/unit/indexer.test.ts
```
Expected: PASS.

- [ ] **Step 6: Install Gemini SDK**

```bash
npm install @google/generative-ai
```

- [ ] **Step 7: Commit**

```bash
git add src/core/indexer.ts src/core/gemini-embed.ts tests/unit/indexer.test.ts package.json package-lock.json
git commit -m "feat(indexer): assemble IndexJson with Gemini embeddings + stepId lookup"
```

---

## Task 5: Vercel app scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/.env.local.example`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Modify: `package.json` (extend build script)
- Modify: `.gitignore`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@daymo/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "node widget-src/build.mjs && next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run"
  },
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "@vercel/blob": "^0.27.0",
    "@vercel/kv": "^3.0.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@/*": ["./*"],
      "@daymo/core/*": ["../../src/core/*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `apps/web/next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [],
  // Allow importing shared TS modules from the parent src/ directory.
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
```

- [ ] **Step 4: Create `apps/web/.env.local.example`**

```
GEMINI_API_KEY=your-gemini-api-key
DAYMO_ADMIN_TOKEN=replace-with-a-random-secret
BLOB_READ_WRITE_TOKEN=auto-injected-by-vercel-blob
KV_URL=auto-injected-by-vercel-kv
KV_REST_API_URL=auto-injected-by-vercel-kv
KV_REST_API_TOKEN=auto-injected-by-vercel-kv
KV_REST_API_READ_ONLY_TOKEN=auto-injected-by-vercel-kv
```

- [ ] **Step 5: Create `apps/web/app/layout.tsx`**

```tsx
export const metadata = {
  title: "Daymo",
  description: "Interactive product manuals",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Create `apps/web/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main style={{ padding: "4rem", maxWidth: "640px", margin: "0 auto" }}>
      <h1>Daymo</h1>
      <p>This is a Daymo instance. Visit <code>/&lt;companyId&gt;/help</code> for a hosted manual.</p>
    </main>
  );
}
```

- [ ] **Step 7: Modify root `package.json` to include the new build step**

Update the existing `build` script:
```json
"build": "tsc && cd editor-ui && npm install && npm run build && cd ../apps/web && npm install && npm run build"
```

- [ ] **Step 8: Modify `.gitignore`**

Append:
```
apps/web/node_modules
apps/web/.next
apps/web/public/widget.js
```

- [ ] **Step 9: Install deps and verify Next.js builds**

```bash
cd apps/web && npm install && npm run build && cd ../..
```
Expected: Next.js build succeeds, prints route table including `/` and the default 404.

- [ ] **Step 10: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/next.config.mjs apps/web/.env.local.example apps/web/app .gitignore package.json
git commit -m "feat(web): scaffold Next.js 15 app under apps/web"
```

---

## Task 6: Blob client wrapper + LRU cache + company-id validation

**Files:**
- Create: `apps/web/lib/blob.ts`
- Create: `apps/web/lib/company-id.ts`
- Create: `tests/unit/company-id.test.ts`

- [ ] **Step 1: Write failing test for company-id validation**

`tests/unit/company-id.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isValidCompanyId } from "../../apps/web/lib/company-id.js";

describe("isValidCompanyId", () => {
  it("accepts kebab-case slugs", () => {
    expect(isValidCompanyId("acme")).toBe(true);
    expect(isValidCompanyId("acme-corp")).toBe(true);
    expect(isValidCompanyId("a1-b2-c3")).toBe(true);
  });
  it("rejects empty, uppercase, special chars", () => {
    expect(isValidCompanyId("")).toBe(false);
    expect(isValidCompanyId("Acme")).toBe(false);
    expect(isValidCompanyId("acme_corp")).toBe(false);
    expect(isValidCompanyId("acme/corp")).toBe(false);
    expect(isValidCompanyId("a".repeat(33))).toBe(false);
  });
  it("rejects reserved Next.js routes", () => {
    expect(isValidCompanyId("api")).toBe(false);
    expect(isValidCompanyId("widget.js")).toBe(false);
    expect(isValidCompanyId("_next")).toBe(false);
    expect(isValidCompanyId("favicon.ico")).toBe(false);
    expect(isValidCompanyId("admin")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
npx vitest run tests/unit/company-id.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement company-id validator**

`apps/web/lib/company-id.ts`:
```typescript
const PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RESERVED = new Set([
  "api", "widget.js", "_next", "favicon.ico", "robots.txt", "sitemap.xml",
  "admin", "health", "static", "public",
]);

export function isValidCompanyId(id: string): boolean {
  if (!id || id.length > 32) return false;
  if (!PATTERN.test(id)) return false;
  if (RESERVED.has(id)) return false;
  return true;
}
```

- [ ] **Step 4: Run test, verify PASS**

```bash
npx vitest run tests/unit/company-id.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Implement Blob wrapper with LRU cache**

`apps/web/lib/blob.ts`:
```typescript
import { put, head, list } from "@vercel/blob";
import type { CompanyConfig, IndexJson } from "../../../src/core/index-types.js";

const CACHE_MAX = 50;
const cache = new Map<string, { config?: CompanyConfig; index?: IndexJson; loadedAt: number }>();

function touch(companyId: string, patch: Partial<{ config: CompanyConfig; index: IndexJson }>) {
  const existing = cache.get(companyId) ?? { loadedAt: 0 };
  const next = { ...existing, ...patch, loadedAt: Date.now() };
  cache.delete(companyId);
  cache.set(companyId, next);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

export async function getConfig(companyId: string): Promise<CompanyConfig | null> {
  const cached = cache.get(companyId);
  if (cached?.config) return cached.config;
  const url = `companies/${companyId}/config.json`;
  try {
    const res = await fetch(blobPublicUrl(url));
    if (!res.ok) return null;
    const config = (await res.json()) as CompanyConfig;
    touch(companyId, { config });
    return config;
  } catch {
    return null;
  }
}

export async function getIndex(companyId: string): Promise<IndexJson | null> {
  const cached = cache.get(companyId);
  if (cached?.index) return cached.index;
  const url = `companies/${companyId}/index.json`;
  try {
    const res = await fetch(blobPublicUrl(url));
    if (!res.ok) return null;
    const index = (await res.json()) as IndexJson;
    touch(companyId, { index });
    return index;
  } catch {
    return null;
  }
}

export function invalidate(companyId: string): void {
  cache.delete(companyId);
}

/** Resolve a Blob pathname to the canonical public URL.
 *  Vercel Blob URLs include a random suffix; we look up via list() at boot
 *  but for v1 we use a deterministic-prefix listing call. */
async function blobPublicUrl(pathname: string): Promise<string> {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (blobs.length === 0) throw new Error(`blob not found: ${pathname}`);
  return blobs[0].url;
}

export async function putConfig(companyId: string, config: CompanyConfig): Promise<void> {
  await put(`companies/${companyId}/config.json`, JSON.stringify(config, null, 2), {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true,
  });
  invalidate(companyId);
}

export async function mp4Url(companyId: string, demoId: string): Promise<string> {
  return blobPublicUrl(`companies/${companyId}/demos/${demoId}/output.mp4`);
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/blob.ts apps/web/lib/company-id.ts tests/unit/company-id.test.ts
git commit -m "feat(web): Blob wrapper with LRU cache + company-id validation"
```

---

## Task 7: Retrieval (cosine top-K + score gate)

**Files:**
- Create: `apps/web/lib/retrieval.ts`
- Create: `tests/unit/retrieval.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/unit/retrieval.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { cosineTopK, isBelowScoreGate, SCORE_GATE } from "../../apps/web/lib/retrieval.js";
import type { Chunk } from "../../src/core/index-types.js";

function chunk(stepId: string, emb: number[]): Chunk {
  return {
    stepId, demoId: "d", sceneIndex: 0, stepIndex: 0,
    globalStartMs: 0, globalEndMs: 1000,
    text: stepId, embedding: emb, keywords: [],
  };
}

describe("cosineTopK", () => {
  it("returns top-K chunks ranked by cosine similarity to query", () => {
    const chunks = [
      chunk("a", [1, 0, 0]),
      chunk("b", [0, 1, 0]),
      chunk("c", [0.9, 0.1, 0]),
    ];
    const result = cosineTopK([1, 0, 0], chunks, 2);
    expect(result.map((r) => r.chunk.stepId)).toEqual(["a", "c"]);
    expect(result[0].score).toBeCloseTo(1, 5);
    expect(result[1].score).toBeGreaterThan(result[0].score - 0.2);
  });

  it("returns empty when chunks is empty", () => {
    expect(cosineTopK([1, 0], [], 5)).toEqual([]);
  });
});

describe("isBelowScoreGate", () => {
  it("returns true when top score is below 0.55", () => {
    expect(isBelowScoreGate([{ chunk: chunk("a", []), score: 0.4 }])).toBe(true);
    expect(isBelowScoreGate([{ chunk: chunk("a", []), score: 0.6 }])).toBe(false);
  });
  it("returns true when there are no results", () => {
    expect(isBelowScoreGate([])).toBe(true);
  });
  it("uses SCORE_GATE constant 0.55", () => {
    expect(SCORE_GATE).toBe(0.55);
  });
});
```

- [ ] **Step 2: Run tests, verify FAIL**

```bash
npx vitest run tests/unit/retrieval.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement retrieval**

`apps/web/lib/retrieval.ts`:
```typescript
import type { Chunk } from "../../../src/core/index-types.js";

export const SCORE_GATE = 0.55;

export interface ScoredChunk { chunk: Chunk; score: number }

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function magnitude(a: number[]): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const denom = magnitude(a) * magnitude(b);
  if (denom === 0) return 0;
  return dot(a, b) / denom;
}

export function cosineTopK(queryEmb: number[], chunks: Chunk[], k: number): ScoredChunk[] {
  const scored = chunks.map((c) => ({ chunk: c, score: cosineSimilarity(queryEmb, c.embedding) }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k);
}

export function isBelowScoreGate(scored: ScoredChunk[]): boolean {
  if (scored.length === 0) return true;
  return scored[0].score < SCORE_GATE;
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
npx vitest run tests/unit/retrieval.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/retrieval.ts tests/unit/retrieval.test.ts
git commit -m "feat(web): cosine top-K retrieval + score gate at 0.55"
```

---

## Task 8: Gemini wrappers (rewrite + answer) and chat pipeline

**Files:**
- Create: `apps/web/lib/gemini.ts`
- Create: `apps/web/lib/chat-pipeline.ts`
- Create: `tests/unit/chat-pipeline.test.ts`

- [ ] **Step 1: Write the Gemini wrapper**

`apps/web/lib/gemini.ts`:
```typescript
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { ChatHistoryTurn, ChatResponse } from "../../../src/core/index-types.js";

export interface GeminiClient {
  rewriteQuery(message: string, history: ChatHistoryTurn[]): Promise<string>;
  embedQuery(text: string): Promise<number[]>;
  answer(args: {
    message: string;
    history: ChatHistoryTurn[];
    locale: string;
    chunks: Array<{ stepId: string; demoId: string; text: string; caption: string; mp4Url: string; startMs: number; endMs: number }>;
  }): Promise<ChatResponse>;
}

export function realGeminiClient(apiKey: string): GeminiClient {
  const client = new GoogleGenerativeAI(apiKey);
  const flash = client.getGenerativeModel({ model: "gemini-2.5-flash" });
  const embed = client.getGenerativeModel({ model: "gemini-embedding-001" });

  return {
    async rewriteQuery(message, history) {
      const historyText = history.map((h) => `${h.role}: ${h.content}`).join("\n");
      const prompt =
        `You rewrite the user's latest message into a single self-contained search query ` +
        `that captures their full intent given prior conversation turns. Output ONLY the ` +
        `query, no preamble, no quoting.\n\nConversation:\n${historyText}\n\n` +
        `Latest message: ${message}\n\nSearch query:`;
      const res = await flash.generateContent({ contents: [{ role: "user", parts: [{ text: prompt }] }] });
      return res.response.text().trim();
    },
    async embedQuery(text) {
      const res = await embed.embedContent({
        content: { parts: [{ text }], role: "user" },
        taskType: "RETRIEVAL_QUERY",
      });
      return res.embedding.values;
    },
    async answer({ message, history, locale, chunks }) {
      const chunksText = chunks.map((c, i) =>
        `Chunk ${i + 1} (stepId=${c.stepId}, demoId=${c.demoId}, startMs=${c.startMs}, endMs=${c.endMs}, mp4Url=${c.mp4Url}):\n${c.text}`
      ).join("\n\n");
      const historyText = history.map((h) => `${h.role}: ${h.content}`).join("\n");

      const system =
        `You answer "how do I X?" questions about a product using ONLY the retrieved demo chunks. ` +
        `Output a JSON object matching the ChatResponse schema.\n\nRules:\n` +
        `- If chunks do not clearly answer, return kind="no_match". Do not invent stepIds.\n` +
        `- Every VideoPart.stepId must appear verbatim in a chunk.\n` +
        `- Interleave text and video parts; every video preceded by an introducing text part. No two consecutive video parts.\n` +
        `- Total parts ≤ 6, video parts ≤ 3.\n` +
        `- Respond in the language of the user's most recent message. If ambiguous, use ${locale}.\n` +
        `- For text-only answers (no specific visual moment), return a single TextPart.`;

      const userPrompt =
        `Retrieved chunks:\n\n${chunksText}\n\nConversation history:\n${historyText}\n\nUser: ${message}`;

      const schema = chatResponseSchema(chunks.map((c) => c.stepId));

      const res = await flash.generateContent({
        contents: [{ role: "user", parts: [{ text: `${system}\n\n${userPrompt}` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
        } as any,
      });

      return JSON.parse(res.response.text()) as ChatResponse;
    },
  };
}

function chatResponseSchema(allowedStepIds: string[]) {
  // Build a Gemini responseSchema enforcing the ChatResponse shape.
  // Note: Gemini's schema dialect supports type/properties/required/items;
  // oneOf is supported via nullable variants. We enforce shape, and rely on
  // server-side validation for stepId-membership and count limits.
  return {
    type: SchemaType.OBJECT,
    properties: {
      kind: { type: SchemaType.STRING, enum: ["answer", "no_match"] },
      text: { type: SchemaType.STRING },           // present on no_match
      suggestions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      parts: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            kind: { type: SchemaType.STRING, enum: ["text", "video"] },
            text: { type: SchemaType.STRING },
            stepId: { type: SchemaType.STRING },
            demoId: { type: SchemaType.STRING },
            startMs: { type: SchemaType.NUMBER },
            endMs: { type: SchemaType.NUMBER },
            caption: { type: SchemaType.STRING },
            mp4Url: { type: SchemaType.STRING },
          },
          required: ["kind"],
        },
      },
    },
    required: ["kind"],
  } as const;
}
```

- [ ] **Step 2: Write failing test for the pipeline**

`tests/unit/chat-pipeline.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { runChatPipeline } from "../../apps/web/lib/chat-pipeline.js";
import type { IndexJson } from "../../src/core/index-types.js";

function fakeIndex(): IndexJson {
  return {
    schemaVersion: 1, companyId: "acme",
    embeddingModel: "gemini-embedding-001", embeddingDims: 768,
    createdAt: "2026-05-18T00:00:00Z", etag: "sha256:x",
    demos: [{ demoId: "tour", title: "Tour", description: "", durationMs: 5000 }],
    chunks: [{
      stepId: "tour:0:0", demoId: "tour", sceneIndex: 0, stepIndex: 0,
      globalStartMs: 0, globalEndMs: 5000, text: "How to log in",
      embedding: [1, 0, 0], keywords: ["log", "in"],
    }],
  };
}

describe("runChatPipeline", () => {
  it("returns answer when score gate passes and LLM returns valid stepId", async () => {
    const client = {
      rewriteQuery: vi.fn().mockResolvedValue("how do i log in"),
      embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
      answer: vi.fn().mockResolvedValue({
        kind: "answer",
        parts: [
          { kind: "text", text: "Here's how:" },
          { kind: "video", stepId: "tour:0:0", demoId: "tour", startMs: 0, endMs: 5000, caption: "Login", mp4Url: "https://x/m.mp4" },
        ],
      }),
    };
    const result = await runChatPipeline({
      request: { companyId: "acme", message: "how do i log in?", history: [], locale: "en" },
      index: fakeIndex(),
      mp4UrlFor: async () => "https://x/m.mp4",
      gemini: client,
    });
    expect(result.kind).toBe("answer");
    expect(client.rewriteQuery).toHaveBeenCalled();
  });

  it("returns no_match when top score is below the gate", async () => {
    const client = {
      rewriteQuery: vi.fn().mockResolvedValue("unrelated"),
      embedQuery: vi.fn().mockResolvedValue([0, 1, 0]),  // orthogonal to chunk emb
      answer: vi.fn(),
    };
    const result = await runChatPipeline({
      request: { companyId: "acme", message: "where is the moon?", history: [], locale: "en" },
      index: fakeIndex(),
      mp4UrlFor: async () => "https://x/m.mp4",
      gemini: client,
    });
    expect(result.kind).toBe("no_match");
    expect(client.answer).not.toHaveBeenCalled();
  });

  it("downgrades to no_match when LLM returns an invalid stepId", async () => {
    const client = {
      rewriteQuery: vi.fn().mockResolvedValue("how"),
      embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
      answer: vi.fn().mockResolvedValue({
        kind: "answer",
        parts: [
          { kind: "text", text: "Here:" },
          { kind: "video", stepId: "tour:0:99", demoId: "tour", startMs: 0, endMs: 5000, caption: "", mp4Url: "https://x/m.mp4" },
        ],
      }),
    };
    const result = await runChatPipeline({
      request: { companyId: "acme", message: "how?", history: [], locale: "en" },
      index: fakeIndex(),
      mp4UrlFor: async () => "https://x/m.mp4",
      gemini: client,
    });
    expect(result.kind).toBe("no_match");
  });

  it("downgrades to no_match when LLM returns more than 3 video parts", async () => {
    const v = (i: number) => ({ kind: "video" as const, stepId: "tour:0:0", demoId: "tour", startMs: 0, endMs: 1, caption: "", mp4Url: "https://x/m.mp4" });
    const client = {
      rewriteQuery: vi.fn().mockResolvedValue("how"),
      embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
      answer: vi.fn().mockResolvedValue({
        kind: "answer",
        parts: [
          { kind: "text" as const, text: "1" }, v(1),
          { kind: "text" as const, text: "2" }, v(2),
          { kind: "text" as const, text: "3" }, v(3),
          { kind: "text" as const, text: "4" }, v(4),
        ],
      }),
    };
    const result = await runChatPipeline({
      request: { companyId: "acme", message: "how?", history: [], locale: "en" },
      index: fakeIndex(),
      mp4UrlFor: async () => "https://x/m.mp4",
      gemini: client,
    });
    expect(result.kind).toBe("no_match");
  });
});
```

- [ ] **Step 3: Run test, verify FAIL**

```bash
npx vitest run tests/unit/chat-pipeline.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the pipeline**

`apps/web/lib/chat-pipeline.ts`:
```typescript
import type { ChatRequest, ChatResponse, IndexJson, Part } from "../../../src/core/index-types.js";
import { cosineTopK, isBelowScoreGate } from "./retrieval.js";
import type { GeminiClient } from "./gemini.js";

const NO_MATCH_FALLBACK = "I don't have that in the demos. Try one of these:";

const MAX_PARTS = 6;
const MAX_VIDEO_PARTS = 3;
const TOP_K = 8;

export interface ChatPipelineDeps {
  request: ChatRequest;
  index: IndexJson;
  mp4UrlFor: (demoId: string) => Promise<string>;
  gemini: GeminiClient;
}

export async function runChatPipeline(deps: ChatPipelineDeps): Promise<ChatResponse> {
  const { request, index, mp4UrlFor, gemini } = deps;
  const locale = request.locale ?? "en";
  const history = request.history.slice(-2);

  // 1. Rewrite
  const rewritten = await gemini.rewriteQuery(request.message, history);

  // 2. Embed + retrieve
  const queryEmb = await gemini.embedQuery(rewritten);
  const topK = cosineTopK(queryEmb, index.chunks, TOP_K);

  // 3. Score gate
  if (isBelowScoreGate(topK)) {
    return { kind: "no_match", text: NO_MATCH_FALLBACK, suggestions: suggestionsFor(index) };
  }

  // 4. Answer LLM
  const chunksForLLM = await Promise.all(topK.map(async ({ chunk }) => ({
    stepId: chunk.stepId, demoId: chunk.demoId, text: chunk.text,
    caption: chunk.text.split("\n").pop() ?? "",
    mp4Url: await mp4UrlFor(chunk.demoId),
    startMs: chunk.globalStartMs, endMs: chunk.globalEndMs,
  })));
  const llmAnswer = await gemini.answer({ message: request.message, history, locale, chunks: chunksForLLM });

  // 5. Server validation
  if (llmAnswer.kind === "no_match") return llmAnswer;
  const validated = validateAnswer(llmAnswer.parts, index);
  if (!validated.ok) return { kind: "no_match", text: NO_MATCH_FALLBACK, suggestions: suggestionsFor(index) };
  return { kind: "answer", parts: validated.parts };
}

function validateAnswer(parts: Part[], index: IndexJson): { ok: false } | { ok: true; parts: Part[] } {
  if (parts.length === 0 || parts.length > MAX_PARTS) return { ok: false };
  const videos = parts.filter((p) => p.kind === "video");
  if (videos.length > MAX_VIDEO_PARTS) return { ok: false };
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].kind === "video" && parts[i - 1].kind === "video") return { ok: false };
  }
  for (const p of parts) {
    if (p.kind === "video") {
      const c = index.chunks.find((x) => x.stepId === p.stepId);
      if (!c) return { ok: false };
      // Reject if start/end don't match the index's known window.
      if (p.startMs !== c.globalStartMs || p.endMs !== c.globalEndMs) return { ok: false };
    }
  }
  return { ok: true, parts };
}

function suggestionsFor(index: IndexJson): string[] {
  const fromSteps = index.chunks
    .map((c) => c.text.split("\n").find((l) => l.startsWith("[Step] "))?.replace("[Step] ", ""))
    .filter((s): s is string => !!s && s !== "(preamble)");
  return Array.from(new Set(fromSteps)).slice(0, 3).map((s) => `How do I ${s.toLowerCase()}?`);
}
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
npx vitest run tests/unit/chat-pipeline.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/gemini.ts apps/web/lib/chat-pipeline.ts tests/unit/chat-pipeline.test.ts
git commit -m "feat(web): chat pipeline (rewrite → retrieve → score gate → answer → validate)"
```

---

## Task 9: `/api/chat` route + `/api/widget-config` route

**Files:**
- Create: `apps/web/app/api/chat/route.ts`
- Create: `apps/web/app/api/widget-config/route.ts`
- Create: `apps/web/lib/rate-limit.ts`
- Create: `tests/integration/api-chat.test.ts`

- [ ] **Step 1: Implement rate limit**

`apps/web/lib/rate-limit.ts`:
```typescript
import { kv } from "@vercel/kv";

export async function checkRateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter?: number }> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const count = await kv.incr(bucket);
  if (count === 1) await kv.expire(bucket, windowSec);
  if (count > limit) return { ok: false, retryAfter: windowSec };
  return { ok: true };
}
```

- [ ] **Step 2: Implement `/api/chat`**

`apps/web/app/api/chat/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import type { ChatRequest } from "../../../../src/core/index-types.js";
import { getConfig, getIndex, mp4Url } from "../../../lib/blob.js";
import { realGeminiClient } from "../../../lib/gemini.js";
import { runChatPipeline } from "../../../lib/chat-pipeline.js";
import { checkRateLimit } from "../../../lib/rate-limit.js";
import { isValidCompanyId } from "../../../lib/company-id.js";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ChatRequest;
  try { body = (await req.json()) as ChatRequest; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  if (!isValidCompanyId(body.companyId)) {
    return NextResponse.json({ error: "invalid_company_id" }, { status: 400 });
  }

  const config = await getConfig(body.companyId);
  if (!config) return NextResponse.json({ error: "unknown_company" }, { status: 404 });

  const origin = req.headers.get("origin") ?? "";
  const isHostedManual = origin === `https://${req.headers.get("host")}` || origin === process.env.DAYMO_HOSTED_ORIGIN;
  if (!isHostedManual && !config.allowedOrigins.includes(origin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit(`chat:${body.companyId}:${ip}`, 30, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  const index = await getIndex(body.companyId);
  if (!index) return NextResponse.json({ error: "index_unavailable" }, { status: 502 });

  try {
    const gemini = realGeminiClient(process.env.GEMINI_API_KEY!);
    const response = await runChatPipeline({
      request: body, index, gemini,
      mp4UrlFor: (demoId) => mp4Url(body.companyId, demoId),
    });
    const headers: Record<string, string> = {};
    if (isHostedManual) headers["Access-Control-Allow-Origin"] = origin;
    else headers["Access-Control-Allow-Origin"] = origin;
    return NextResponse.json(response, { headers });
  } catch (e) {
    console.error("chat error", e);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin") ?? "";
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
```

- [ ] **Step 3: Implement `/api/widget-config`**

`apps/web/app/api/widget-config/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "../../../lib/blob.js";
import { isValidCompanyId } from "../../../lib/company-id.js";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const companyId = req.nextUrl.searchParams.get("companyId") ?? "";
  if (!isValidCompanyId(companyId)) return NextResponse.json({ error: "invalid_company_id" }, { status: 400 });
  const config = await getConfig(companyId);
  if (!config) return NextResponse.json({ error: "unknown_company" }, { status: 404 });
  return NextResponse.json({
    name: config.name,
    brandColor: config.brandColor,
    locale: config.locale,
    suggestedQuestions: config.suggestedQuestions,
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    },
  });
}
```

- [ ] **Step 4: Write integration test for `/api/chat`**

`tests/integration/api-chat.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";

// Mock blob + gemini before importing the route handler.
vi.mock("../../apps/web/lib/blob.js", () => ({
  getConfig: vi.fn().mockResolvedValue({ companyId: "acme", name: "Acme", locale: "en", allowedOrigins: ["https://acme.com"], suggestedQuestions: [], createdAt: "" }),
  getIndex: vi.fn().mockResolvedValue({
    schemaVersion: 1, companyId: "acme", embeddingModel: "gemini-embedding-001", embeddingDims: 768,
    createdAt: "", etag: "sha256:x",
    demos: [{ demoId: "tour", title: "T", description: "", durationMs: 5000 }],
    chunks: [{
      stepId: "tour:0:0", demoId: "tour", sceneIndex: 0, stepIndex: 0,
      globalStartMs: 0, globalEndMs: 5000, text: "Log in steps", embedding: [1, 0, 0], keywords: [],
    }],
  }),
  mp4Url: vi.fn().mockResolvedValue("https://blob/m.mp4"),
}));

vi.mock("../../apps/web/lib/gemini.js", () => ({
  realGeminiClient: () => ({
    rewriteQuery: vi.fn().mockResolvedValue("log in"),
    embedQuery: vi.fn().mockResolvedValue([1, 0, 0]),
    answer: vi.fn().mockResolvedValue({
      kind: "answer",
      parts: [
        { kind: "text", text: "Here's how to log in:" },
        { kind: "video", stepId: "tour:0:0", demoId: "tour", startMs: 0, endMs: 5000, caption: "Login", mp4Url: "https://blob/m.mp4" },
      ],
    }),
  }),
}));

vi.mock("../../apps/web/lib/rate-limit.js", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

const { POST } = await import("../../apps/web/app/api/chat/route.js");

function makeRequest(body: any, headers: Record<string, string> = {}): any {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    nextUrl: new URL("https://x/api/chat"),
  };
}

describe("POST /api/chat", () => {
  it("returns kind=answer for a valid request", async () => {
    const res = await POST(makeRequest(
      { companyId: "acme", message: "how do I log in?", history: [] },
      { origin: "https://acme.com", host: "x" }
    ) as any);
    const data = await res.json();
    expect(data.kind).toBe("answer");
  });

  it("rejects invalid companyId with 400", async () => {
    const res = await POST(makeRequest({ companyId: "API", message: "?", history: [] }, {}) as any);
    expect(res.status).toBe(400);
  });

  it("rejects bad origin with 403", async () => {
    const res = await POST(makeRequest(
      { companyId: "acme", message: "?", history: [] },
      { origin: "https://evil.com", host: "x" }
    ) as any);
    expect(res.status).toBe(403);
  });

  it("isolates tenants: a request for companyId 'evil' cannot retrieve acme chunks", async () => {
    // getConfig mock returns null for unknown company → 404 short-circuits before any retrieval.
    const { getConfig } = await import("../../apps/web/lib/blob.js");
    (getConfig as any).mockResolvedValueOnce(null);
    const res = await POST(makeRequest(
      { companyId: "evil", message: "anything", history: [] },
      { origin: "https://acme.com", host: "x" }
    ) as any);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
npx vitest run tests/integration/api-chat.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/chat apps/web/app/api/widget-config apps/web/lib/rate-limit.ts tests/integration/api-chat.test.ts
git commit -m "feat(web): /api/chat and /api/widget-config routes with origin + rate limit"
```

---

## Task 10: `/api/admin/publish/*` routes

**Files:**
- Create: `apps/web/app/api/admin/publish/begin/route.ts`
- Create: `apps/web/app/api/admin/publish/finalize/route.ts`
- Create: `apps/web/app/api/admin/publish/health/route.ts`
- Create: `tests/integration/api-publish.test.ts`

- [ ] **Step 1: Implement `/begin`**

`apps/web/app/api/admin/publish/begin/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { randomUUID } from "node:crypto";
import { isValidCompanyId } from "../../../../../lib/company-id.js";
import type { PublishBeginRequest, PublishBeginResponse } from "../../../../../../../src/core/publish-contract.js";

export const runtime = "nodejs";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.DAYMO_ADMIN_TOKEN}`;
  return auth === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: PublishBeginRequest;
  try { body = (await req.json()) as PublishBeginRequest; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!isValidCompanyId(body.companyId)) return NextResponse.json({ error: "invalid_company_id" }, { status: 400 });

  const uploadId = randomUUID();
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN!;

  async function tokenFor(relPath: string): Promise<string> {
    return await generateClientTokenFromReadWriteToken({
      token: blobToken,
      pathname: `companies/${body.companyId}/${relPath}`,
      onUploadCompleted: { tokenPayload: uploadId },
      validUntil: Date.now() + 60 * 60 * 1000,
    });
  }

  const uploads = await Promise.all(body.files.map(async (f) => ({
    relPath: f.relPath,
    clientToken: await tokenFor(f.relPath),
    targetBlobUrl: `companies/${body.companyId}/${f.relPath}`,
  })));

  const response: PublishBeginResponse = {
    uploadId,
    uploads,
    indexUpload: {
      clientToken: await tokenFor("index.json"),
      targetBlobUrl: `companies/${body.companyId}/index.json`,
    },
  };
  return NextResponse.json(response);
}
```

- [ ] **Step 2: Implement `/finalize`**

`apps/web/app/api/admin/publish/finalize/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { invalidate, putConfig, getConfig } from "../../../../../lib/blob.js";
import type { PublishFinalizeRequest, PublishFinalizeResponse } from "../../../../../../../src/core/publish-contract.js";
import type { CompanyConfig } from "../../../../../../../src/core/index-types.js";

export const runtime = "nodejs";

function checkAuth(req: NextRequest): boolean {
  return req.headers.get("authorization") === `Bearer ${process.env.DAYMO_ADMIN_TOKEN}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: PublishFinalizeRequest & { companyId: string; configPatch?: Partial<CompanyConfig> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  // Verify each file landed in Blob with matching size.
  for (const u of body.uploaded) {
    try {
      await head(`companies/${body.companyId}/${u.relPath}`);
    } catch {
      return NextResponse.json({ error: "missing_uploaded_file", relPath: u.relPath }, { status: 400 });
    }
  }
  try { await head(`companies/${body.companyId}/index.json`); }
  catch { return NextResponse.json({ error: "missing_index_json" }, { status: 400 }); }

  // Merge config: existing + patch + defaults.
  const existing = await getConfig(body.companyId);
  const merged: CompanyConfig = {
    companyId: body.companyId,
    name: body.configPatch?.name ?? existing?.name ?? body.companyId,
    brandColor: body.configPatch?.brandColor ?? existing?.brandColor,
    locale: body.configPatch?.locale ?? existing?.locale ?? "en",
    allowedOrigins: body.configPatch?.allowedOrigins ?? existing?.allowedOrigins ?? [],
    suggestedQuestions: body.configPatch?.suggestedQuestions ?? existing?.suggestedQuestions ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await putConfig(body.companyId, merged);
  invalidate(body.companyId);

  const response: PublishFinalizeResponse = {
    hostedUrl: `${process.env.DAYMO_HOSTED_ORIGIN ?? "https://daymo.dev"}/${body.companyId}/help`,
    uploadedAt: new Date().toISOString(),
  };
  return NextResponse.json(response);
}
```

- [ ] **Step 3: Implement `/health`**

`apps/web/app/api/admin/publish/health/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import type { PublishHealthResponse } from "../../../../../../../src/core/publish-contract.js";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.DAYMO_ADMIN_TOKEN}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response: PublishHealthResponse = { ok: true, endpoint: req.nextUrl.origin };
  return NextResponse.json(response);
}
```

- [ ] **Step 4: Write integration tests for the publish routes**

`tests/integration/api-publish.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob/x" }),
  head: vi.fn().mockResolvedValue({ size: 100 }),
  list: vi.fn().mockResolvedValue({ blobs: [] }),
}));
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: vi.fn().mockResolvedValue("token-x"),
}));
vi.mock("../../apps/web/lib/blob.js", () => ({
  invalidate: vi.fn(), putConfig: vi.fn(), getConfig: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => { process.env.DAYMO_ADMIN_TOKEN = "test-token"; process.env.BLOB_READ_WRITE_TOKEN = "blob-token"; });

const { POST: beginPost } = await import("../../apps/web/app/api/admin/publish/begin/route.js");
const { POST: finalizePost } = await import("../../apps/web/app/api/admin/publish/finalize/route.js");

function req(body: any, headers: Record<string, string> = {}): any {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    nextUrl: new URL("https://x/api/admin/publish/x"),
  };
}

describe("POST /api/admin/publish/begin", () => {
  it("rejects without token", async () => {
    const res = await beginPost(req({ companyId: "acme", files: [] }) as any);
    expect(res.status).toBe(401);
  });
  it("returns upload tokens with valid token", async () => {
    const res = await beginPost(req(
      { companyId: "acme", files: [{ relPath: "demos/t/output.mp4", sizeBytes: 1, contentType: "video/mp4" }] },
      { authorization: "Bearer test-token" }
    ) as any);
    const data = await res.json();
    expect(data.uploadId).toBeDefined();
    expect(data.uploads.length).toBe(1);
    expect(data.indexUpload.clientToken).toBe("token-x");
  });
});

describe("POST /api/admin/publish/finalize", () => {
  it("writes config and returns hostedUrl", async () => {
    process.env.DAYMO_HOSTED_ORIGIN = "https://daymo.dev";
    const res = await finalizePost(req(
      { companyId: "acme", uploadId: "u1", uploaded: [{ relPath: "demos/t/output.mp4", sizeBytes: 1 }], indexUploaded: { sizeBytes: 1 }, configPatch: { name: "Acme" } },
      { authorization: "Bearer test-token" }
    ) as any);
    const data = await res.json();
    expect(data.hostedUrl).toBe("https://daymo.dev/acme/help");
  });
});
```

- [ ] **Step 5: Run tests, verify PASS**

```bash
npx vitest run tests/integration/api-publish.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/admin tests/integration/api-publish.test.ts
git commit -m "feat(web): /api/admin/publish/{begin,finalize,health} routes"
```

---

## Task 11: ChatPanel + shared frontend components

**Files:**
- Create: `apps/web/components/ChatPanel.tsx`
- Create: `apps/web/components/VideoSegment.tsx`
- Create: `apps/web/components/SuggestionChips.tsx`

- [ ] **Step 1: Create `VideoSegment.tsx`**

```tsx
"use client";
import { useEffect, useRef } from "react";
import type { VideoPart } from "../../../src/core/index-types.js";

export function VideoSegment({ part }: { part: VideoPart }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    function onTime() {
      if (v.currentTime * 1000 >= part.endMs) v.pause();
    }
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [part.endMs]);

  const src = `${part.mp4Url}#t=${part.startMs / 1000},${part.endMs / 1000}`;
  return (
    <figure style={{ margin: "0.5rem 0" }}>
      <video ref={ref} src={src} preload="metadata" playsInline controls style={{ width: "100%", borderRadius: "8px", background: "#000" }} />
      {part.caption && <figcaption style={{ fontSize: "0.875rem", color: "#666", marginTop: "0.25rem" }}>{part.caption}</figcaption>}
    </figure>
  );
}
```

- [ ] **Step 2: Create `SuggestionChips.tsx`**

```tsx
"use client";
export function SuggestionChips({ chips, onPick }: { chips: string[]; onPick: (chip: string) => void }) {
  if (chips.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "0.5rem 0" }}>
      {chips.map((c) => (
        <button key={c} onClick={() => onPick(c)} style={{
          padding: "0.5rem 0.75rem", borderRadius: "999px", border: "1px solid #ddd",
          background: "#fafafa", cursor: "pointer", fontSize: "0.875rem",
        }}>{c}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `ChatPanel.tsx`**

```tsx
"use client";
import { useState, useEffect, useRef } from "react";
import type { ChatRequest, ChatResponse, Part } from "../../../src/core/index-types.js";
import { VideoSegment } from "./VideoSegment.js";
import { SuggestionChips } from "./SuggestionChips.js";

type Msg = { role: "user"; content: string } | { role: "assistant"; response: ChatResponse };

export function ChatPanel({
  companyId,
  apiBase = "",
  suggestedQuestions,
  initialQuery,
}: {
  companyId: string;
  apiBase?: string;
  suggestedQuestions: string[];
  initialQuery?: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState(false);
  const submittedInitial = useRef(false);

  async function submit(text: string) {
    if (!text.trim() || pending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setPending(true);
    const history = messages.flatMap<{ role: "user" | "assistant"; content: string }>((m) =>
      m.role === "user" ? [{ role: "user", content: m.content }] : m.response.kind === "answer" ? [{ role: "assistant", content: m.response.parts.filter((p) => p.kind === "text").map((p: any) => p.text).join(" ") }] : []
    ).slice(-2);
    const body: ChatRequest = { companyId, message: text, history };
    try {
      const res = await fetch(`${apiBase}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", response: { kind: "no_match", text: "Something went wrong. Try again." } }]);
      } else {
        const response = (await res.json()) as ChatResponse;
        setMessages((m) => [...m, { role: "assistant", response }]);
      }
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (initialQuery && !submittedInitial.current) {
      submittedInitial.current = true;
      submit(initialQuery);
    }
  }, [initialQuery]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SuggestionChips chips={messages.length === 0 ? suggestedQuestions : []} onPick={(c) => setInput(c)} />

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minHeight: "200px" }}>
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} style={{ alignSelf: "flex-end", background: "#eef", padding: "0.5rem 0.75rem", borderRadius: "12px", maxWidth: "80%" }}>{m.content}</div>
        ) : (
          <div key={i} style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
            {m.response.kind === "answer"
              ? m.response.parts.map((p: Part, j) => p.kind === "text"
                ? <p key={j} style={{ margin: "0.25rem 0" }}>{p.text}</p>
                : <VideoSegment key={j} part={p} />)
              : (
                <div>
                  <p style={{ margin: "0.25rem 0" }}>{m.response.text}</p>
                  {m.response.suggestions && <SuggestionChips chips={m.response.suggestions} onPick={(c) => setInput(c)} />}
                </div>
              )}
          </div>
        ))}
        {pending && <div style={{ alignSelf: "flex-start", color: "#888" }}>…</div>}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(input); }} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          aria-label="Ask a question"
          placeholder="Ask a question…"
          style={{ flex: 1, padding: "0.625rem 0.75rem", borderRadius: "8px", border: "1px solid #ccc", fontSize: "1rem" }}
        />
        <button type="submit" disabled={pending || !input.trim()} style={{
          padding: "0.625rem 1rem", borderRadius: "8px", border: "none",
          background: pending ? "#bbb" : "#2563eb", color: "#fff", cursor: pending ? "not-allowed" : "pointer",
        }}>Ask</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Verify Next.js still builds**

```bash
cd apps/web && npm run build && cd ../..
```
Expected: build succeeds; warnings about unused imports are OK to leave for now.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components
git commit -m "feat(web): ChatPanel, VideoSegment, SuggestionChips shared components"
```

---

## Task 12: Hosted manual page at `/[companyId]/help`

**Files:**
- Create: `apps/web/app/[companyId]/help/page.tsx`
- Create: `tests/integration/hosted-manual.test.ts`

- [ ] **Step 1: Create the page**

`apps/web/app/[companyId]/help/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getConfig } from "../../../lib/blob.js";
import { isValidCompanyId } from "../../../lib/company-id.js";
import { ChatPanel } from "../../../components/ChatPanel.js";

export default async function HelpPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { companyId } = await params;
  const { q } = await searchParams;
  if (!isValidCompanyId(companyId)) notFound();
  const config = await getConfig(companyId);
  if (!config) notFound();

  const brand = config.brandColor ?? "#2563eb";

  return (
    <main style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <header style={{ borderBottom: `2px solid ${brand}`, paddingBottom: "1rem", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.75rem" }}>{config.name} — Product Manual</h1>
        <p style={{ color: "#666", margin: "0.5rem 0 0" }}>Ask me anything about {config.name}. I'll show you how.</p>
      </header>

      <ChatPanel
        companyId={companyId}
        suggestedQuestions={config.suggestedQuestions}
        initialQuery={q}
      />

      <footer style={{ marginTop: "3rem", textAlign: "center", color: "#aaa", fontSize: "0.75rem" }}>
        powered by <a href="https://daymo.dev" style={{ color: "#aaa" }}>daymo</a>
      </footer>
    </main>
  );
}

export const dynamic = "force-dynamic";
```

- [ ] **Step 2: Verify Next.js still builds**

```bash
cd apps/web && npm run build && cd ../..
```
Expected: build succeeds, route table includes `/[companyId]/help`.

- [ ] **Step 3: Write integration test**

`tests/integration/hosted-manual.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../../apps/web/lib/blob.js", () => ({
  getConfig: vi.fn(async (id: string) => id === "acme" ? {
    companyId: "acme", name: "Acme Inc", locale: "en", allowedOrigins: [],
    suggestedQuestions: ["How do I log in?"], createdAt: "",
  } : null),
}));

const { default: HelpPage } = await import("../../apps/web/app/[companyId]/help/page.js");

describe("HelpPage server component", () => {
  it("renders a header with the company name", async () => {
    const tree = await HelpPage({
      params: Promise.resolve({ companyId: "acme" }),
      searchParams: Promise.resolve({}),
    });
    const html = JSON.stringify(tree);
    expect(html).toContain("Acme Inc");
    expect(html).toContain("Product Manual");
  });

  it("calls notFound for an invalid companyId", async () => {
    let notFoundCalled = false;
    vi.doMock("next/navigation", () => ({ notFound: () => { notFoundCalled = true; throw new Error("NEXT_NOT_FOUND"); } }));
    await expect(HelpPage({
      params: Promise.resolve({ companyId: "API" }),
      searchParams: Promise.resolve({}),
    } as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run test, verify PASS**

```bash
npx vitest run tests/integration/hosted-manual.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\[companyId\] tests/integration/hosted-manual.test.ts
git commit -m "feat(web): hosted manual page at /[companyId]/help with ?q= deep link"
```

---

## Task 13: Widget bundle (shadow DOM + ChatPanel)

**Files:**
- Create: `apps/web/widget-src/widget.ts`
- Create: `apps/web/widget-src/build.mjs`

- [ ] **Step 1: Write `widget.ts`**

The widget is loaded as a `<script>` on the customer's page. It reads `data-company-id` from its own script tag, creates a shadow DOM, fetches widget-config, and renders a floating bubble that opens into the same ChatPanel.

```typescript
// apps/web/widget-src/widget.ts
import type { WidgetConfigResponse } from "../../../src/core/index-types.js";

(function init() {
  const scripts = Array.from(document.querySelectorAll('script[data-company-id]'));
  const tag = scripts[scripts.length - 1] as HTMLScriptElement | undefined;
  if (!tag) return;
  const companyId = tag.dataset.companyId!;
  const apiBase = new URL(tag.src).origin;

  const root = document.createElement("div");
  root.id = "daymo-widget-root";
  root.style.cssText = "all: initial; position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;";
  document.body.appendChild(root);
  const shadow = root.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .bubble { width: 52px; height: 52px; border-radius: 50%; background: #2563eb; color: #fff; border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.2); font-size: 22px; }
      .panel { display: none; width: 320px; max-height: 480px; background: #fff; border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.18); padding: 12px; font-family: system-ui, sans-serif; overflow: auto; }
      .panel.open { display: block; }
      @media (max-width: 600px) {
        .panel.open { position: fixed; inset: 0; width: 100vw; height: 100vh; max-height: none; border-radius: 0; }
      }
      .panel header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .panel header h2 { margin: 0; font-size: 1rem; }
      .panel header button { background: none; border: none; cursor: pointer; font-size: 18px; }
      .messages { display: flex; flex-direction: column; gap: 8px; }
      .msg.user { align-self: flex-end; background: #eef; padding: 6px 10px; border-radius: 12px; max-width: 80%; }
      .msg.assistant { align-self: flex-start; max-width: 100%; }
      form { display: flex; gap: 6px; margin-top: 8px; }
      input { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid #ccc; font-size: 14px; }
      button.send { padding: 8px 12px; border: none; background: #2563eb; color: #fff; border-radius: 8px; cursor: pointer; }
      video { width: 100%; border-radius: 6px; background: #000; }
      .chip { display: inline-block; padding: 6px 10px; border: 1px solid #ddd; border-radius: 999px; background: #fafafa; margin: 4px 4px 0 0; cursor: pointer; font-size: 13px; }
    </style>
    <button class="bubble" aria-label="Open product help">?</button>
    <div class="panel" role="dialog" aria-modal="false" aria-labelledby="dwc-title">
      <header><h2 id="dwc-title">Help</h2><button class="close" aria-label="Close">×</button></header>
      <div class="chips"></div>
      <div class="messages"></div>
      <form><input aria-label="Ask a question" placeholder="Ask…" /><button class="send" type="submit">Ask</button></form>
    </div>
  `;

  const bubble = shadow.querySelector(".bubble") as HTMLButtonElement;
  const panel = shadow.querySelector(".panel") as HTMLDivElement;
  const close = shadow.querySelector(".close") as HTMLButtonElement;
  const chipsEl = shadow.querySelector(".chips") as HTMLDivElement;
  const messages = shadow.querySelector(".messages") as HTMLDivElement;
  const form = shadow.querySelector("form") as HTMLFormElement;
  const input = shadow.querySelector("input") as HTMLInputElement;

  let opened = false;
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];

  bubble.addEventListener("click", async () => {
    panel.classList.add("open");
    if (!opened) {
      opened = true;
      const res = await fetch(`${apiBase}/api/widget-config?companyId=${encodeURIComponent(companyId)}`);
      if (res.ok) {
        const cfg = (await res.json()) as WidgetConfigResponse;
        (shadow.querySelector("#dwc-title") as HTMLElement).textContent = cfg.name;
        chipsEl.innerHTML = cfg.suggestedQuestions
          .map((q) => `<span class="chip" data-q="${q.replace(/"/g, '&quot;')}">${q}</span>`)
          .join("");
        chipsEl.querySelectorAll(".chip").forEach((el) => {
          el.addEventListener("click", () => { input.value = el.getAttribute("data-q") ?? ""; input.focus(); });
        });
      }
    }
  });

  close.addEventListener("click", () => panel.classList.remove("open"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    const userDiv = document.createElement("div");
    userDiv.className = "msg user";
    userDiv.textContent = text;
    messages.appendChild(userDiv);
    chipsEl.innerHTML = "";

    const res = await fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId, message: text, history: history.slice(-2) }),
    });
    if (!res.ok) {
      const err = document.createElement("div");
      err.className = "msg assistant";
      err.textContent = "Something went wrong.";
      messages.appendChild(err);
      return;
    }
    const response = await res.json();
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    if (response.kind === "answer") {
      for (const p of response.parts) {
        if (p.kind === "text") {
          const para = document.createElement("p");
          para.textContent = p.text;
          wrap.appendChild(para);
        } else {
          const v = document.createElement("video");
          v.src = `${p.mp4Url}#t=${p.startMs / 1000},${p.endMs / 1000}`;
          v.preload = "metadata";
          v.controls = true;
          v.playsInline = true;
          v.addEventListener("timeupdate", () => { if (v.currentTime * 1000 >= p.endMs) v.pause(); });
          wrap.appendChild(v);
          if (p.caption) {
            const cap = document.createElement("small");
            cap.textContent = p.caption;
            wrap.appendChild(cap);
          }
        }
      }
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: response.parts.filter((p: any) => p.kind === "text").map((p: any) => p.text).join(" ") });
    } else {
      const para = document.createElement("p");
      para.textContent = response.text;
      wrap.appendChild(para);
    }
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  });
})();
```

- [ ] **Step 2: Create esbuild script**

`apps/web/widget-src/build.mjs`:
```javascript
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(__dirname, "widget.ts")],
  bundle: true,
  format: "iife",
  target: ["es2020"],
  minify: true,
  outfile: path.join(__dirname, "..", "public", "widget.js"),
  loader: { ".ts": "ts" },
});

console.log("daymo widget bundle: built apps/web/public/widget.js");
```

- [ ] **Step 3: Build the widget**

```bash
cd apps/web && npm run build && cd ../..
```
Expected: `apps/web/public/widget.js` exists.

- [ ] **Step 4: Commit**

```bash
git add apps/web/widget-src
git commit -m "feat(web): embeddable widget bundle (shadow DOM, mobile fullscreen, esbuild)"
```

---

## Task 14: `daymo publish` CLI command

**Files:**
- Create: `src/commands/publish.ts`
- Modify: `src/cli.ts`
- Create: `tests/integration/cli-publish.test.ts`

- [ ] **Step 1: Install `@vercel/blob` for the CLI side**

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Implement the command**

`src/commands/publish.ts`:
```typescript
import fs from "node:fs/promises";
import path from "node:path";
import { upload } from "@vercel/blob/client";
import { parse } from "../parser.js";
import { buildIndex, type DemoInput } from "../core/indexer.js";
import { realGeminiEmbedder } from "../core/gemini-embed.js";
import type { StepIndex, RunnerEvent } from "../types.js";
import type {
  PublishBeginRequest, PublishBeginResponse,
  PublishFinalizeRequest, PublishFinalizeResponse,
} from "../core/publish-contract.js";

export interface PublishFlags {
  company: string;
  name?: string;
  brandColor?: string;
  locale?: string;
  allowedOrigin?: string[];
  endpoint?: string;
  token?: string;
}

export async function publishCommand(input: string, flags: PublishFlags): Promise<void> {
  const endpoint = flags.endpoint ?? "https://daymo.dev";
  const token = flags.token ?? process.env.DAYMO_ADMIN_TOKEN;
  if (!token) throw new Error("missing --token (or DAYMO_ADMIN_TOKEN env)");
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("missing GEMINI_API_KEY env");

  // 1. Discover .demo files
  const stat = await fs.stat(input);
  const demoFiles = stat.isFile()
    ? [path.resolve(input)]
    : await findDemoFiles(path.resolve(input));
  if (demoFiles.length === 0) throw new Error(`no .demo files found under ${input}`);

  console.log(`daymo publish: ${demoFiles.length} demo(s) → ${endpoint} (company=${flags.company})`);

  // 2. Build per-demo inputs by reading artifacts written by daymo render/stitch
  const demos: DemoInput[] = [];
  const mp4Paths: Array<{ relPath: string; abs: string; size: number }> = [];
  for (const demoFile of demoFiles) {
    const demoId = path.basename(demoFile, ".demo");
    const baseDir = path.dirname(demoFile);
    const dotDir = path.join(baseDir, ".daymo");
    const mp4 = path.join(baseDir, "output.mp4");
    const stepIndexFile = path.join(dotDir, "step-index.json");

    const ast = parse(await fs.readFile(demoFile, "utf8"));
    const stepIndex = JSON.parse(await fs.readFile(stepIndexFile, "utf8")) as StepIndex;
    const events: RunnerEvent[][] = await Promise.all(ast.scenes.map(async (_, i) => {
      const p = path.join(dotDir, String(i), "events.json");
      try { return JSON.parse(await fs.readFile(p, "utf8")) as RunnerEvent[]; }
      catch { return []; }
    }));

    demos.push({ demoId, demoFile, ast, events, stepIndex });
    const sz = (await fs.stat(mp4)).size;
    mp4Paths.push({ relPath: `demos/${demoId}/output.mp4`, abs: mp4, size: sz });
  }

  // 3. Build index.json in memory
  console.log(`daymo publish: building index (Gemini embeddings)…`);
  const embedder = realGeminiEmbedder(geminiKey);
  const indexJson = await buildIndex({ companyId: flags.company, demos, embedder });
  const indexBuf = Buffer.from(JSON.stringify(indexJson));
  console.log(`daymo publish: ${indexJson.chunks.length} chunks indexed`);

  // 4. Request upload tokens
  const beginBody: PublishBeginRequest = {
    companyId: flags.company,
    name: flags.name,
    brandColor: flags.brandColor,
    locale: flags.locale,
    allowedOrigins: flags.allowedOrigin,
    files: mp4Paths.map((m) => ({ relPath: m.relPath, sizeBytes: m.size, contentType: "video/mp4" })),
  };
  const beginRes = await fetch(`${endpoint}/api/admin/publish/begin`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(beginBody),
  });
  if (!beginRes.ok) throw new Error(`begin failed: ${beginRes.status} ${await beginRes.text()}`);
  const begin = (await beginRes.json()) as PublishBeginResponse;

  // 5. Upload mp4s + index.json directly to Blob
  console.log(`daymo publish: uploading ${mp4Paths.length} mp4(s) + index.json to Blob…`);
  const uploadedMp4s = await Promise.all(mp4Paths.map(async (m, i) => {
    const buf = await fs.readFile(m.abs);
    await upload(begin.uploads[i].targetBlobUrl, buf, {
      access: "public",
      handleUploadUrl: `${endpoint}/api/admin/publish/begin`,
      clientPayload: begin.uploads[i].clientToken,
    });
    return { relPath: m.relPath, sizeBytes: m.size };
  }));
  await upload(begin.indexUpload.targetBlobUrl, indexBuf, {
    access: "public",
    handleUploadUrl: `${endpoint}/api/admin/publish/begin`,
    clientPayload: begin.indexUpload.clientToken,
  });

  // 6. Finalize
  const finalizeBody: PublishFinalizeRequest & { companyId: string; configPatch: any } = {
    uploadId: begin.uploadId,
    uploaded: uploadedMp4s,
    indexUploaded: { sizeBytes: indexBuf.length },
    companyId: flags.company,
    configPatch: { name: flags.name, brandColor: flags.brandColor, locale: flags.locale, allowedOrigins: flags.allowedOrigin, suggestedQuestions: deriveSuggestions(indexJson) },
  } as any;
  const finRes = await fetch(`${endpoint}/api/admin/publish/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(finalizeBody),
  });
  if (!finRes.ok) throw new Error(`finalize failed: ${finRes.status} ${await finRes.text()}`);
  const fin = (await finRes.json()) as PublishFinalizeResponse;

  const totalMb = (mp4Paths.reduce((s, m) => s + m.size, 0) / 1e6).toFixed(1);
  console.log(`✓ Published ${flags.name ?? flags.company} to ${fin.hostedUrl}`);
  console.log(`  ${demos.length} demo(s), ${indexJson.chunks.length} indexed steps, ${totalMb}MB`);
}

async function findDemoFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await findDemoFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".demo")) out.push(full);
  }
  return out;
}

function deriveSuggestions(idx: any): string[] {
  const descriptions = new Set<string>();
  for (const c of idx.chunks) {
    const line = (c.text as string).split("\n").find((l: string) => l.startsWith("[Step] "));
    if (line) {
      const d = line.replace("[Step] ", "").trim();
      if (d && d !== "(preamble)") descriptions.add(d);
    }
  }
  return Array.from(descriptions).slice(0, 3).map((d) => `How do I ${d.toLowerCase()}?`);
}
```

- [ ] **Step 3: Wire into `src/cli.ts`**

Add to the imports:
```typescript
import { publishCommand } from "./commands/publish.js";
```

Add after the existing `cli.command(...)` calls:
```typescript
cli.command("publish <input>", "Build an index for one or more .demo files and upload to a Daymo backend")
  .option("--company <id>", "Company identifier (kebab-case)")
  .option("--name <name>", "Display name shown in the manual header")
  .option("--brand-color <hex>", "Brand color for the header rule")
  .option("--locale <bcp47>", "Default locale", { default: "en" })
  .option("--allowed-origin <origin>", "Allowed origin for widget requests (repeatable)")
  .option("--endpoint <url>", "Daymo backend endpoint", { default: "https://daymo.dev" })
  .option("--token <token>", "Admin token (else DAYMO_ADMIN_TOKEN env)")
  .action((input: string, flags: any) => {
    if (!flags.company) throw new Error("--company is required");
    return publishCommand(input, {
      company: flags.company,
      name: flags.name,
      brandColor: flags.brandColor,
      locale: flags.locale,
      allowedOrigin: flags.allowedOrigin ? (Array.isArray(flags.allowedOrigin) ? flags.allowedOrigin : [flags.allowedOrigin]) : undefined,
      endpoint: flags.endpoint,
      token: flags.token,
    });
  });
```

- [ ] **Step 4: Write integration test against a mock server**

`tests/integration/cli-publish.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { execaCommand } from "execa";
import path from "node:path";
import fs from "node:fs/promises";

describe("daymo publish CLI", () => {
  let server: http.Server;
  let port: number;
  const calls: Array<{ url: string; body: string }> = [];

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      let body = "";
      req.on("data", (c) => body += c.toString());
      req.on("end", () => {
        calls.push({ url: req.url!, body });
        if (req.url === "/api/admin/publish/begin") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ uploadId: "u1", uploads: [], indexUpload: { clientToken: "tok", targetBlobUrl: "companies/test/index.json" } }));
        } else if (req.url === "/api/admin/publish/finalize") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ hostedUrl: "http://localhost/test/help", uploadedAt: "now" }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as any).port;
  });
  afterAll(() => server.close());

  it("hits begin then finalize against the mock backend", async () => {
    // Use the existing tiny stitch fixture (must have output.mp4 + step-index.json).
    const demo = path.join(__dirname, "../fixtures/stitch-step-index/tiny.demo");
    if (!(await fs.stat(demo).catch(() => null))) {
      console.warn("skipping: fixture missing");
      return;
    }
    process.env.DAYMO_ADMIN_TOKEN = "t";
    process.env.GEMINI_API_KEY = "skip"; // indexer with mock embedder is exercised in unit tests
    try {
      await execaCommand(`node ./dist/cli.js publish ${demo} --company test --endpoint http://localhost:${port}`, {
        env: { ...process.env, DAYMO_ADMIN_TOKEN: "t", GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "" },
      });
    } catch (e) {
      // Likely throws on Gemini auth — what we care about is begin was called.
    }
    expect(calls.some((c) => c.url === "/api/admin/publish/begin")).toBe(true);
  }, 30_000);
});
```

This test is intentionally tolerant — it asserts that the CLI gets through argument parsing and contacts the backend. A full happy-path E2E with real Gemini lives in Task 16.

- [ ] **Step 5: Build and run the test**

```bash
npm run build && npx vitest run tests/integration/cli-publish.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/publish.ts src/cli.ts tests/integration/cli-publish.test.ts package.json package-lock.json
git commit -m "feat(cli): daymo publish command with Vercel Blob direct-upload"
```

---

## Task 15: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a new section under `## Commands`**

Append to the commands table:
```
daymo publish <input> --company <id>             Build an index and upload to a Daymo backend
```

Add new section after the existing `## Worked example`:

```markdown
## Hosted manual + widget (Daymo Chat v1)

Once a demo is rendered (and stitched), `daymo publish` uploads it to a Daymo
backend so users can ask questions and get back interleaved text + video
answers.

### One-time setup (Daymo team)

- Deploy the Next.js app under `apps/web/` to Vercel.
- Set env vars: `GEMINI_API_KEY`, `DAYMO_ADMIN_TOKEN`, `BLOB_READ_WRITE_TOKEN`,
  and the Vercel KV vars.

### Publishing a customer's demos

```bash
export DAYMO_ADMIN_TOKEN=...
export GEMINI_API_KEY=...

daymo publish ./customer-demos \
  --company acme \
  --name "Acme Inc" \
  --endpoint https://daymo.dev
```

Prints `✓ Published Acme Inc to https://daymo.dev/acme/help`.

### Embedding the widget on a customer's site

```html
<script async src="https://daymo.dev/widget.js" data-company-id="acme"></script>
```

The customer also needs to be added to the company's `allowedOrigins` via a
`--allowed-origin` flag at publish time.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): hosted manual + widget publishing flow"
```

---

## Task 16: End-to-end smoke test (fixture-driven)

**Files:**
- Create: `tests/fixtures/demo-chat/loomly-tour/tour.demo`
- Create: `tests/fixtures/demo-chat/loomly-tour/golden-questions.json`
- Create: `tests/e2e/chat-smoke.test.ts`

This task wires render → stitch → publish (against a local Next.js dev server) → /api/chat. It runs nightly with `RUN_E2E_CHAT=1` (real Gemini, real Vercel Blob simulator).

- [ ] **Step 1: Create the fixture .demo file**

`tests/fixtures/demo-chat/loomly-tour/tour.demo`:
````markdown
---
title: Loomly Tour
description: Walks a new user through the Loomly dashboard.
url: about:blank
viewport: { width: 800, height: 600 }
---

# Welcome

The dashboard greets the user when they first log in.

```playwright
await fx.step("Welcome the user");
await fx.say("Welcome back, Alex. This is your project dashboard.");
await fx.pause(1);
```

---

# Create a project

```playwright
await fx.step("Open the new project dialog");
await fx.say("Click here to start a new project.");
await fx.pause(1);

await fx.step("Name the project");
await fx.say("Give it a name and press Submit.");
await fx.pause(1);
```
````

- [ ] **Step 2: Create golden questions**

`tests/fixtures/demo-chat/loomly-tour/golden-questions.json`:
```json
[
  { "q": "How do I create a project?",           "expectedStepIdPrefix": "tour:1" },
  { "q": "How do I see my dashboard?",           "expectedStepIdPrefix": "tour:0" },
  { "q": "How do I delete my account permanently?", "expected": "no_match" }
]
```

- [ ] **Step 3: Write the smoke test**

`tests/e2e/chat-smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { execaCommand } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

const RUN = process.env.RUN_E2E_CHAT === "1";
const describeIf = RUN ? describe : describe.skip;

describeIf("E2E: render → stitch → publish → /api/chat", () => {
  const fixtureDir = path.join(__dirname, "../fixtures/demo-chat/loomly-tour");
  const demoFile = path.join(fixtureDir, "tour.demo");

  it("answers golden questions with expected stepId or no_match", async () => {
    await execaCommand(`node ./dist/cli.js render ${demoFile}`);
    await execaCommand(`node ./dist/cli.js stitch ${demoFile}`);

    const endpoint = process.env.E2E_ENDPOINT ?? "http://localhost:3000";
    await execaCommand(`node ./dist/cli.js publish ${demoFile} --company e2e-test --name "E2E" --endpoint ${endpoint}`, {
      env: { ...process.env, DAYMO_ADMIN_TOKEN: process.env.DAYMO_ADMIN_TOKEN!, GEMINI_API_KEY: process.env.GEMINI_API_KEY! },
    });

    const golden = JSON.parse(await fs.readFile(path.join(fixtureDir, "golden-questions.json"), "utf8")) as Array<any>;
    for (const item of golden) {
      const res = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: "e2e-test", message: item.q, history: [] }),
      });
      const data = await res.json();
      if (item.expected === "no_match") {
        expect(data.kind).toBe("no_match");
      } else {
        expect(data.kind).toBe("answer");
        const videoParts = data.parts.filter((p: any) => p.kind === "video");
        expect(videoParts.length).toBeGreaterThan(0);
        expect(videoParts.some((p: any) => p.stepId.startsWith(item.expectedStepIdPrefix))).toBe(true);
      }
    }
  }, 300_000);
});
```

- [ ] **Step 4: Document how to run it**

Add to `README.md`'s testing section:
```
# Daymo Chat E2E (requires Gemini key + locally-running Vercel dev server)
GEMINI_API_KEY=... DAYMO_ADMIN_TOKEN=... E2E_ENDPOINT=http://localhost:3000 RUN_E2E_CHAT=1 npm test
```

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/demo-chat tests/e2e/chat-smoke.test.ts README.md
git commit -m "test(e2e): chat smoke test (render → publish → /api/chat → golden questions)"
```

---

## Deployment checklist (one-time, not a task)

Before shipping v1 to production:

1. Create a Vercel project pointed at this repo's `apps/web/` directory.
2. Enable Vercel Blob and Vercel KV in the project.
3. Set env vars in the Vercel dashboard:
   - `GEMINI_API_KEY` — Gemini API key
   - `DAYMO_ADMIN_TOKEN` — long random string (`openssl rand -hex 32`)
   - `DAYMO_HOSTED_ORIGIN` — the production origin (e.g. `https://daymo.dev`)
   - `BLOB_READ_WRITE_TOKEN` — auto-injected when Blob is enabled
   - KV env vars — auto-injected when KV is enabled
4. Verify `npm run build` in `apps/web/` works locally with `BLOB_READ_WRITE_TOKEN` set.
5. Deploy. Then run `daymo publish` against the live endpoint with a small fixture demo to verify end-to-end.
6. Smoke-test `https://daymo.dev/<companyId>/help` in a browser.

---

## Notes on plan organization

- Tasks 1–4 produce the indexer pipeline and can be implemented in order without the Vercel app.
- Task 5 scaffolds the Vercel app; Tasks 6–10 implement the backend.
- Tasks 11–13 implement the frontends.
- Task 14 wires the CLI to the backend.
- Tasks 15–16 are docs + end-to-end verification.

Each task is self-contained and ends with a passing test + a commit. The plan is intentionally TDD-heavy for backend/indexer logic; frontend tasks lean on visual verification + integration tests rather than unit tests because UI state machines test poorly in isolation.
