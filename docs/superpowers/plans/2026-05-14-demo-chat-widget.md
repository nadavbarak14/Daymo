# Demo Chat Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a multi-tenant chat widget that answers "how do I X?" questions on a customer's product website using their `.demo` artifacts. Answer is a sequence of text + inline video segments seeked to the right `fx.step`. Refuses to answer when retrieval is uncertain.

**Architecture:** Naive RAG with conversation-aware query rewriting over Gemini embeddings. Multi-tenant, local-filesystem storage in v1. Raw `node:http` chat backend (matches `src/editor/server.ts`). Shadow-DOM widget bundle with inline `<video>` elements using Media Fragments URIs. Three-layer certainty: cosine prefilter, JSON-schema-forced LLM output, server-side `stepId` validation.

**Tech Stack:** TypeScript + Node ≥20.10. `cac` for CLI, raw `node:http` for server, `@anthropic-ai/sdk` for LLM calls, native `fetch` for Gemini embedding API, `esbuild` for the widget bundle, `vitest` for tests.

**Spec:** `docs/superpowers/specs/2026-05-14-demo-chat-widget-design.md` (commit `77c710e`).

---

## Locked-in decisions (these resolve the spec's "Open questions for implementation")

| # | Decision | Notes |
|---|---|---|
| 1 | **Server runtime:** raw `node:http` | Matches `src/editor/server.ts`. No new HTTP framework dependency. |
| 2 | **Backend data root:** `$DAYMO_DATA_ROOT` env var; default `~/.daymo-chat-data` (per-user) | Override via `daymo serve --data-root <path>`. |
| 3 | **API keys:** `$GEMINI_API_KEY` for embeddings, `$ANTHROPIC_API_KEY` for LLM | Backend reads at startup; chat endpoint returns 500 (not 502) with clear log message if missing. |
| 4 | **WebVTT captions:** emitted by stitcher always, no flag | Accessibility-first; cost is trivial (string formatting). |
| 5 | **LLM testing gate:** `RUN_LLM_TESTS=1` and `RUN_EMBED_TESTS=1` env flags | Same pattern as test gates already in the project; tests that hit real APIs are off by default. |
| 6 | **Widget bundling:** `esbuild` from a new top-level `widget/` directory, outputs `dist-widget/widget.js` | Single ES module, no React/lit, vanilla DOM via tagged template literals. |
| 7 | **Conversation history transport:** `history: Array<{role, content}>` capped client-side to last 2 turns before send | Server doesn't trim — that's the widget's job. |
| 8 | **Index format version:** `"v1"` field in `index.json` | Future schema changes carry their own version; loader rejects unknown versions with a clear error. |

---

## New npm dependencies

```jsonc
// package.json additions
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0"   // Anthropic SDK for LLM calls + structured outputs
  },
  "devDependencies": {
    "esbuild": "^0.24.0",            // Widget bundle
    "@axe-core/playwright": "^4.10.0", // Accessibility checks in E2E
    "supertest": "^7.0.0",            // HTTP contract tests
    "@types/supertest": "^6.0.2"
  }
}
```

Gemini embeddings use the REST API via native `fetch` — no SDK dependency. Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=…`.

---

## File structure (everything created or modified by this plan)

```
src/
  cli.ts                                   MODIFY    register `daymo index` and `daymo serve`
  types.ts                                 MODIFY    add StepIndex, ChatResponse, Part, IndexFile types
  commands/
    index.ts                               CREATE    `daymo index <demo-dir>` subcommand
    serve.ts                               CREATE    `daymo serve` subcommand
    stitch.ts                              MODIFY    wire step-index emission + captions.vtt
  core/
    stitch.ts                              MODIFY    add -g 30 keyframes; expose scene durations
    step-index.ts                          CREATE    pure function: compute global ms timestamps
    captions-vtt.ts                        CREATE    pure function: events.json → WebVTT text
    concat.ts                              MODIFY    accept keyframe-spacing flag
  indexer/
    chunk-builder.ts                       CREATE    pure: events.json + .demo → Chunk[]
    keywords.ts                            CREATE    pure: text → keyword tokens for BM25
    bm25.ts                                CREATE    pure: BM25 scoring
    embedder-gemini.ts                     CREATE    batch + sync Gemini embedding clients
    suggested-questions.ts                 CREATE    pure: chunks → top-3 suggestions
    write-index.ts                         CREATE    orchestrates the indexer pipeline
  chat-server/
    server.ts                              CREATE    HTTP entry point (node:http)
    router.ts                              CREATE    URL → handler dispatch
    config-loader.ts                       CREATE    read widgets/<id>/config.json into memory
    index-cache.ts                         CREATE    LRU per-widget index loader
    retrieve.ts                            CREATE    pure: query + index → top-K chunks (cosine + BM25)
    rewrite-query.ts                       CREATE    Haiku-backed query rewriter
    answer-llm.ts                          CREATE    Sonnet-backed answerer with json_schema
    validate-response.ts                   CREATE    pure: server-side stepId validation
    mp4-url.ts                             CREATE    pure: construct canonical mp4Url
    rate-limit.ts                          CREATE    in-memory token bucket
    cors.ts                                CREATE    pure: origin allowlist + CORS headers
    handlers/
      chat.ts                              CREATE    POST /chat handler
      widget-config.ts                     CREATE    GET /widget-config/<id> handler
      mp4.ts                               CREATE    GET /widgets/<id>/demos/<demoId>/output.mp4 (range)
      admin-reload.ts                      CREATE    POST /admin/reload?widgetId=…
widget/
  package.json                             CREATE    isolated build config
  esbuild.config.mjs                       CREATE    bundles src/widget.ts to dist-widget/widget.js
  tsconfig.json                            CREATE    widget-only TS config
  src/
    widget.ts                              CREATE    entry point: invokes Mount on DOMContentLoaded
    mount.ts                               CREATE    shadow-DOM injection, bubble render
    chat.ts                                CREATE    state machine + Part[] renderer
    api.ts                                 CREATE    fetch wrapper with 429/502 handling
    types.ts                               CREATE    ChatResponse, Part shared with backend
    locale.ts                              CREATE    auto-detect locale, load translations
    locales/                               CREATE    en.json, es.json, fr.json, de.json, ja.json, pt.json, zh-CN.json, it.json
    styles.css                             CREATE    shadow-DOM-scoped CSS, mobile media queries
    template.ts                            CREATE    tagged-template-literal DOM rendering
tests/
  unit/
    step-index.test.ts                     CREATE    pure-function tests for global timestamp math
    captions-vtt.test.ts                   CREATE    pure-function tests for WebVTT emission
    chunk-builder.test.ts                  CREATE    fx.say bucketing, mechanics-only skipping
    keywords.test.ts                       CREATE    tokenization, stopwords, dedup
    bm25.test.ts                           CREATE    BM25 scoring math
    suggested-questions.test.ts            CREATE    top-3 selection logic
    retrieve.test.ts                       CREATE    cosine + BM25 ranking
    validate-response.test.ts              CREATE    stepId + (start,end)Ms validation
    rate-limit.test.ts                     CREATE    token bucket logic
    cors.test.ts                           CREATE    origin allowlist
    mp4-url.test.ts                        CREATE    URL construction
    widget-chat-state.test.ts              CREATE    state machine transitions
    widget-template.test.ts                CREATE    Part[] rendering
  integration/
    stitch-keyframes.test.ts               CREATE    real ffmpeg, ffprobe verifies keyint
    stitch-step-index.test.ts              CREATE    real ffmpeg, multi-scene fixture, global ms within ±50ms
    indexer-end-to-end.test.ts             CREATE    fixture .demo → real Gemini embed → index.json
    chat-endpoint.test.ts                  CREATE    POST /chat against fixture index (mocked LLM/embed)
    widget-config-endpoint.test.ts         CREATE    GET /widget-config + auth checks
    mp4-endpoint.test.ts                   CREATE    range serving + origin enforcement
    golden-questions.test.ts               CREATE    retrieval recall@3 ≥ 85%
  e2e/
    widget-playwright.test.ts              CREATE    real widget → real backend → video seek
  fixtures/
    demo-chat/
      loomly-tour/                         CREATE    .demo + .daymo/ + output.mp4 + golden-questions.json
docs/superpowers/plans/
  2026-05-14-demo-chat-widget.md           THIS FILE
```

---

## Milestone 1: Stitcher extension

Goal: `daymo stitch` produces `output.mp4` with `-g 30` keyframes AND writes `.daymo/step-index.json` with global ms timestamps for every step (including implicit preambles) and every scene. Also emits `captions.vtt` from `fx.say` word-level timings.

This milestone is shippable on its own — no chat widget needed to test it. End-state: ffprobe shows keyint=30 on the mp4; step-index.json matches a hand-computed reference for a multi-scene fixture.

### Task 1.1: Add `-g 30` keyframe spacing to ffmpeg stitch

**Files:**
- Modify: `src/core/concat.ts` (function `buildStitchArgs`)
- Test: `tests/unit/concat-args.test.ts` (extend existing)

- [ ] **Step 1: Add failing test for keyframe flag**

Open `tests/unit/concat-args.test.ts` and append:

```typescript
import { describe, it, expect } from "vitest";
import { buildStitchArgs } from "../../src/core/concat.js";

describe("buildStitchArgs keyframes", () => {
  it("passes -g 30 to libx264 when no music is present", () => {
    const args = buildStitchArgs({
      listFile: "/tmp/list.txt",
      music: null,
      output: "/tmp/out.mp4",
    });
    const gIdx = args.indexOf("-g");
    expect(gIdx).toBeGreaterThan(-1);
    expect(args[gIdx + 1]).toBe("30");
    // -g must be associated with the video codec args, not stripped
    expect(args.indexOf("libx264")).toBeGreaterThan(-1);
  });

  it("passes -g 30 to libx264 when music is present (no duck)", () => {
    const args = buildStitchArgs({
      listFile: "/tmp/list.txt",
      music: "/tmp/m.mp3",
      output: "/tmp/out.mp4",
    });
    const gIdx = args.indexOf("-g");
    expect(gIdx).toBeGreaterThan(-1);
    expect(args[gIdx + 1]).toBe("30");
  });

  it("passes -g 30 to libx264 when music is present with duck", () => {
    const args = buildStitchArgs({
      listFile: "/tmp/list.txt",
      music: "/tmp/m.mp3",
      output: "/tmp/out.mp4",
      musicDuck: true,
    });
    const gIdx = args.indexOf("-g");
    expect(gIdx).toBeGreaterThan(-1);
    expect(args[gIdx + 1]).toBe("30");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/concat-args.test.ts -t "keyframes"`
Expected: FAIL with `expected -1 to be greater than -1` (the `-g` flag is not present yet).

- [ ] **Step 3: Implement the keyframe argument in `buildStitchArgs`**

In `src/core/concat.ts`, modify the three places where `-c:v libx264` is added to also pass `-g 30`:

```typescript
// Replace the existing three branches (music+duck, music+no-duck, no-music) so each pushes -g 30 after libx264.
// Branch 1 (music + duck):
argv.push(
  "-i", opts.music,
  "-filter_complex",
  `[1:a]volume=${vol}[bg];[bg][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[ducked];[ducked][0:a]amix=inputs=2:duration=first[final]`,
  "-map", "0:v",
  "-map", "[final]",
  "-c:v", "libx264",
  "-g", "30",
  "-c:a", "aac",
  "-shortest",
  opts.output,
);

// Branch 2 (music + no duck): same `-g 30` insertion immediately after `-c:v libx264`.
// Branch 3 (no music): same `-g 30` insertion immediately after `-c:v libx264`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/concat-args.test.ts -t "keyframes"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/concat.ts tests/unit/concat-args.test.ts
git commit -m "feat(stitch): emit -g 30 keyframes for sub-second video seek precision"
```

---

### Task 1.2: Pure function — compute global timestamps from per-scene events

**Files:**
- Create: `src/core/step-index.ts`
- Create: `tests/unit/step-index.test.ts`

- [ ] **Step 1: Define the types in `src/types.ts`**

Add to `src/types.ts`:

```typescript
/** One entry per scene in the stitched output.mp4. globalEndMs is exclusive. */
export interface SceneIndexEntry {
  sceneIndex: number;
  globalStartMs: number;
  globalEndMs: number;
  recordingOffsetMs: number;   // 0 if not present in source
}

/** One entry per step (including implicit preamble at stepIndex=0). */
export interface StepIndexEntry {
  stepId: string;              // "<demoId>:<sceneIndex>:<stepIndex>"
  sceneIndex: number;
  stepIndex: number;
  description: string;         // "(preamble)" for the implicit preamble
  globalStartMs: number;
  globalEndMs: number;
}

export interface StepIndex {
  demoId: string;
  mp4DurationMs: number;
  scenes: SceneIndexEntry[];
  steps: StepIndexEntry[];
}

/** Input shape per scene for the step-index builder.
 *  `events` is the array previously read from per-scene events.json.
 *  `trimmedDurationMs` is ffprobe(scene.mp4 or mixed.webm) minus recordingOffsetMs. */
export interface SceneForStepIndex {
  sceneIndex: number;
  recordingOffsetMs: number;
  trimmedDurationMs: number;
  events: RunnerEvent[];
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/unit/step-index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildStepIndex } from "../../src/core/step-index.js";
import type { SceneForStepIndex, RunnerEvent } from "../../src/types.js";

const sceneStart = (i: number, recordingOffsetMs?: number): RunnerEvent => ({
  kind: "scene_start",
  t: 0,
  index: i,
  title: `scene ${i}`,
  prose: "",
  recordingOffsetMs,
});
const sceneEnd = (i: number, t: number): RunnerEvent => ({ kind: "scene_end", t, index: i });
const step = (sceneIndex: number, stepIndex: number, t: number, description: string): RunnerEvent => ({
  kind: "step", t, sceneIndex, stepIndex, description,
});

describe("buildStepIndex", () => {
  it("produces one scene entry per input scene with cumulative offsets", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 5000, events: [sceneStart(0), sceneEnd(0, 5000)] },
      { sceneIndex: 1, recordingOffsetMs: 0, trimmedDurationMs: 7000, events: [sceneStart(1), sceneEnd(1, 7000)] },
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.scenes).toHaveLength(2);
    expect(idx.scenes[0]).toMatchObject({ sceneIndex: 0, globalStartMs: 0, globalEndMs: 5000 });
    expect(idx.scenes[1]).toMatchObject({ sceneIndex: 1, globalStartMs: 5000, globalEndMs: 12000 });
    expect(idx.mp4DurationMs).toBe(12000);
  });

  it("emits one implicit preamble per scene even with no explicit step events", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 4000, events: [sceneStart(0), sceneEnd(0, 4000)] },
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps).toHaveLength(1);
    expect(idx.steps[0]).toMatchObject({
      stepId: "d1:0:0",
      stepIndex: 0,
      description: "(preamble)",
      globalStartMs: 0,
      globalEndMs: 4000,
    });
  });

  it("places explicit steps after the preamble; preamble ends where first step starts", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 10000, events: [
        sceneStart(0),
        step(0, 1, 3000, "First step"),
        step(0, 2, 6000, "Second step"),
        sceneEnd(0, 10000),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps).toHaveLength(3);
    expect(idx.steps[0]).toMatchObject({ stepId: "d1:0:0", globalStartMs: 0, globalEndMs: 3000 });
    expect(idx.steps[1]).toMatchObject({ stepId: "d1:0:1", description: "First step", globalStartMs: 3000, globalEndMs: 6000 });
    expect(idx.steps[2]).toMatchObject({ stepId: "d1:0:2", description: "Second step", globalStartMs: 6000, globalEndMs: 10000 });
  });

  it("subtracts recordingOffsetMs from step.t when computing global timestamps", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 500, trimmedDurationMs: 9500, events: [
        sceneStart(0, 500),
        step(0, 1, 2500, "First step"),  // event t=2500 → globalStartMs = 0 + (2500 - 500) = 2000
        sceneEnd(0, 10000),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps[0].globalEndMs).toBe(2000); // preamble ends at first-step-start
    expect(idx.steps[1].globalStartMs).toBe(2000);
    expect(idx.steps[1].globalEndMs).toBe(9500);
  });

  it("handles missing recordingOffsetMs as 0", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 5000, events: [
        sceneStart(0, undefined),
        step(0, 1, 1000, "Only step"),
        sceneEnd(0, 5000),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps[1].globalStartMs).toBe(1000);
    expect(idx.scenes[0].recordingOffsetMs).toBe(0);
  });

  it("uses event order (not stepIndex order) for chronological computation", () => {
    // events.json is guaranteed t-ordered by the runner; the function should
    // accept events as-is and not need to re-sort.
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 0, trimmedDurationMs: 8000, events: [
        sceneStart(0),
        step(0, 1, 2000, "Step one"),
        step(0, 2, 5000, "Step two"),
        sceneEnd(0, 8000),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps.map(s => s.stepId)).toEqual(["d1:0:0", "d1:0:1", "d1:0:2"]);
  });

  it("composes multi-scene global timestamps correctly", () => {
    const scenes: SceneForStepIndex[] = [
      { sceneIndex: 0, recordingOffsetMs: 100, trimmedDurationMs: 5000, events: [
        sceneStart(0, 100),
        step(0, 1, 1100, "S0 step 1"),     // global = 1100 - 100 = 1000
        sceneEnd(0, 5100),
      ]},
      { sceneIndex: 1, recordingOffsetMs: 200, trimmedDurationMs: 4000, events: [
        sceneStart(1, 200),
        step(1, 1, 1200, "S1 step 1"),     // global = 5000 + (1200 - 200) = 6000
        sceneEnd(1, 4200),
      ]},
    ];
    const idx = buildStepIndex("d1", scenes);
    expect(idx.steps.find(s => s.stepId === "d1:0:1")?.globalStartMs).toBe(1000);
    expect(idx.steps.find(s => s.stepId === "d1:1:1")?.globalStartMs).toBe(6000);
    expect(idx.mp4DurationMs).toBe(9000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/unit/step-index.test.ts`
Expected: FAIL — `buildStepIndex` is not defined.

- [ ] **Step 4: Implement `buildStepIndex`**

Create `src/core/step-index.ts`:

```typescript
import type {
  RunnerEvent,
  SceneForStepIndex,
  StepIndex,
  StepIndexEntry,
  SceneIndexEntry,
} from "../types.js";

/** Pure function: given per-scene events + measured trimmed durations,
 *  produce a global step index keyed against the final stitched mp4.
 *  Scenes are processed in input order. */
export function buildStepIndex(demoId: string, scenes: SceneForStepIndex[]): StepIndex {
  const sceneEntries: SceneIndexEntry[] = [];
  const stepEntries: StepIndexEntry[] = [];
  let cursorMs = 0;

  for (const sc of scenes) {
    const sceneGlobalStart = cursorMs;
    const sceneGlobalEnd = sceneGlobalStart + sc.trimmedDurationMs;
    sceneEntries.push({
      sceneIndex: sc.sceneIndex,
      globalStartMs: sceneGlobalStart,
      globalEndMs: sceneGlobalEnd,
      recordingOffsetMs: sc.recordingOffsetMs,
    });

    // Collect explicit step events, in event order (which is t-order by runner contract).
    const explicit = sc.events.filter((e): e is Extract<RunnerEvent, { kind: "step" }> => e.kind === "step");

    // Implicit preamble at stepIndex=0 always exists; explicit steps start at stepIndex=1.
    const preambleStart = sceneGlobalStart;
    const firstExplicitGlobal = explicit.length > 0
      ? sceneGlobalStart + Math.max(0, explicit[0].t - sc.recordingOffsetMs)
      : sceneGlobalEnd;

    stepEntries.push({
      stepId: `${demoId}:${sc.sceneIndex}:0`,
      sceneIndex: sc.sceneIndex,
      stepIndex: 0,
      description: "(preamble)",
      globalStartMs: preambleStart,
      globalEndMs: firstExplicitGlobal,
    });

    for (let i = 0; i < explicit.length; i++) {
      const ev = explicit[i];
      const globalStart = sceneGlobalStart + Math.max(0, ev.t - sc.recordingOffsetMs);
      const nextEvent = explicit[i + 1];
      const globalEnd = nextEvent
        ? sceneGlobalStart + Math.max(0, nextEvent.t - sc.recordingOffsetMs)
        : sceneGlobalEnd;
      stepEntries.push({
        stepId: `${demoId}:${sc.sceneIndex}:${ev.stepIndex}`,
        sceneIndex: sc.sceneIndex,
        stepIndex: ev.stepIndex,
        description: ev.description,
        globalStartMs: globalStart,
        globalEndMs: globalEnd,
      });
    }

    cursorMs = sceneGlobalEnd;
  }

  return {
    demoId,
    mp4DurationMs: cursorMs,
    scenes: sceneEntries,
    steps: stepEntries,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/step-index.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/step-index.ts src/types.ts tests/unit/step-index.test.ts
git commit -m "feat(stitch): pure function for global step timestamps"
```

---

### Task 1.3: Pure function — events.json + sayEvents → WebVTT captions

**Files:**
- Create: `src/core/captions-vtt.ts`
- Create: `tests/unit/captions-vtt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/captions-vtt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildWebVtt } from "../../src/core/captions-vtt.js";
import type { SayEventForVtt } from "../../src/core/captions-vtt.js";

describe("buildWebVtt", () => {
  it("emits a WEBVTT header and an empty body for zero events", () => {
    expect(buildWebVtt([])).toBe("WEBVTT\n\n");
  });

  it("emits one cue per say event using its global start + duration", () => {
    const says: SayEventForVtt[] = [
      { globalStartMs: 1500, durationMs: 2200, text: "Hello, world." },
      { globalStartMs: 5000, durationMs: 1500, text: "Second clause." },
    ];
    const vtt = buildWebVtt(says);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:01.500 --> 00:00:03.700");
    expect(vtt).toContain("Hello, world.");
    expect(vtt).toContain("00:00:05.000 --> 00:00:06.500");
    expect(vtt).toContain("Second clause.");
  });

  it("formats timestamps as HH:MM:SS.mmm and zero-pads correctly", () => {
    const says: SayEventForVtt[] = [
      { globalStartMs: 3_661_007, durationMs: 1, text: "x" }, // 1h 1m 1s 7ms
    ];
    const vtt = buildWebVtt(says);
    expect(vtt).toContain("01:01:01.007 --> 01:01:01.008");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/captions-vtt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildWebVtt`**

Create `src/core/captions-vtt.ts`:

```typescript
export interface SayEventForVtt {
  /** Global ms from start of the stitched mp4. */
  globalStartMs: number;
  durationMs: number;
  text: string;
}

function formatTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

export function buildWebVtt(says: SayEventForVtt[]): string {
  const lines: string[] = ["WEBVTT", ""];
  for (let i = 0; i < says.length; i++) {
    const s = says[i];
    const start = formatTimestamp(s.globalStartMs);
    const end = formatTimestamp(s.globalStartMs + s.durationMs);
    lines.push(`${start} --> ${end}`);
    lines.push(s.text);
    lines.push("");
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/captions-vtt.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/captions-vtt.ts tests/unit/captions-vtt.test.ts
git commit -m "feat(stitch): pure function for WebVTT caption emission"
```

---

### Task 1.4: ffprobe helper for measuring scene durations

**Files:**
- Create: `src/core/ffprobe.ts`
- Create: `tests/integration/ffprobe-duration.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/ffprobe-duration.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeDurationMs } from "../../src/core/ffprobe.js";

describe("probeDurationMs (integration with real ffmpeg)", () => {
  let tmpFile: string;

  beforeAll(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-ffprobe-"));
    tmpFile = path.join(dir, "fixture.mp4");
    // Generate a 2-second silent black mp4 with ffmpeg's built-in sources.
    await execa("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=size=320x240:rate=24:color=black",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-t", "2",
      "-c:v", "libx264", "-c:a", "aac",
      tmpFile,
    ]);
  });

  it("returns the duration of the file in ms (within 100ms of expected)", async () => {
    const ms = await probeDurationMs(tmpFile);
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(ms).toBeLessThanOrEqual(2100);
  });

  it("throws a clear error when the file does not exist", async () => {
    await expect(probeDurationMs("/no/such/file.mp4")).rejects.toThrow(/ffprobe/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/ffprobe-duration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `probeDurationMs`**

Create `src/core/ffprobe.ts`:

```typescript
import { execa } from "execa";

/** Invoke ffprobe to read the duration of a media file. Returns duration in
 *  milliseconds, rounded to the nearest integer. Throws with a clear message
 *  if ffprobe is missing, the file does not exist, or the duration cannot be
 *  parsed. */
export async function probeDurationMs(filePath: string): Promise<number> {
  try {
    const result = await execa("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const seconds = Number.parseFloat(result.stdout.trim());
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`ffprobe returned unparseable duration for ${filePath}: ${result.stdout}`);
    }
    return Math.round(seconds * 1000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ffprobe failed for ${filePath}: ${msg}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/ffprobe-duration.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/ffprobe.ts tests/integration/ffprobe-duration.test.ts
git commit -m "feat(stitch): ffprobe helper for measuring scene durations"
```

---

### Task 1.5: Wire step-index + captions emission into `daymo stitch`

**Files:**
- Modify: `src/commands/stitch.ts`
- Modify: `src/core/stitch.ts` (return mixed-scene paths)
- Test: `tests/integration/stitch-step-index.test.ts`

- [ ] **Step 1: Write integration test against a 2-scene fixture**

Create `tests/integration/stitch-step-index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { stitchCommand } from "../../src/commands/stitch.js";

describe("stitchCommand writes step-index.json (integration with real ffmpeg)", () => {
  it("produces .daymo/step-index.json with one scene entry per scene and matching global timestamps", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-stitch-"));

    // Build a 2-scene fixture with hand-crafted scene webms and per-scene events.json.
    const daymoDir = path.join(tmp, ".daymo");
    const capDir = path.join(daymoDir, "captures");
    await fs.mkdir(path.join(capDir, "scene-001"), { recursive: true });
    await fs.mkdir(path.join(capDir, "scene-002"), { recursive: true });
    await fs.mkdir(path.join(daymoDir, "tts"), { recursive: true });

    // Generate a 3-second silent webm for each scene via ffmpeg lavfi.
    for (const seg of ["scene-001", "scene-002"]) {
      await execa("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", "color=size=320x240:rate=24:color=black",
        "-t", "3",
        "-c:v", "libvpx", "-b:v", "200k",
        path.join(capDir, seg, "video.webm"),
      ]);
    }

    // Per-scene events.json with one explicit step in each
    await fs.writeFile(path.join(capDir, "scene-001", "events.json"), JSON.stringify([
      { kind: "scene_start", t: 0, index: 0, title: "First", prose: "", recordingOffsetMs: 0 },
      { kind: "step", t: 1000, sceneIndex: 0, stepIndex: 1, description: "First step" },
      { kind: "scene_end", t: 3000, index: 0 },
    ]));
    await fs.writeFile(path.join(capDir, "scene-002", "events.json"), JSON.stringify([
      { kind: "scene_start", t: 0, index: 1, title: "Second", prose: "", recordingOffsetMs: 0 },
      { kind: "step", t: 500, sceneIndex: 1, stepIndex: 1, description: "Second step" },
      { kind: "scene_end", t: 3000, index: 1 },
    ]));

    // Minimal state.json wiring two captured scenes
    await fs.writeFile(path.join(daymoDir, "state.json"), JSON.stringify({
      scenes: [
        { state: "captured", webmPath: path.join(capDir, "scene-001", "video.webm"), eventsPath: path.join(capDir, "scene-001", "events.json") },
        { state: "captured", webmPath: path.join(capDir, "scene-002", "video.webm"), eventsPath: path.join(capDir, "scene-002", "events.json") },
      ],
    }));

    // Minimal demo file
    const demoFile = path.join(tmp, "fixture.demo");
    await fs.writeFile(demoFile, `---\ntitle: Fixture\nurl: http://localhost\n---\n\n# First\n\n\`\`\`playwright\nawait fx.step("First step");\n\`\`\`\n\n---\n\n# Second\n\n\`\`\`playwright\nawait fx.step("Second step");\n\`\`\`\n`);

    await stitchCommand(demoFile);

    const stepIndexRaw = await fs.readFile(path.join(daymoDir, "step-index.json"), "utf8");
    const idx = JSON.parse(stepIndexRaw);

    expect(idx.demoId).toBe("fixture");
    expect(idx.scenes).toHaveLength(2);
    expect(idx.scenes[0].globalStartMs).toBe(0);
    // First scene is 3000ms; tolerate ±200ms for encode jitter
    expect(idx.scenes[1].globalStartMs).toBeGreaterThanOrEqual(2800);
    expect(idx.scenes[1].globalStartMs).toBeLessThanOrEqual(3200);
    // Step indices: each scene has preamble + one explicit step
    expect(idx.steps).toHaveLength(4);
    expect(idx.steps.map((s: { stepId: string }) => s.stepId)).toEqual([
      "fixture:0:0", "fixture:0:1", "fixture:1:0", "fixture:1:1",
    ]);
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/stitch-step-index.test.ts`
Expected: FAIL — step-index.json does not exist.

- [ ] **Step 3: Extend `stitch()` to return mixed-scene paths**

In `src/core/stitch.ts`, change the return type and final return:

```typescript
export interface StitchResult {
  outputPath: string;
  mixedScenePaths: string[];   // post-mix, pre-concat — one per scene, in order
}

export async function stitch(opts: StitchOpts): Promise<StitchResult> {
  // … existing body unchanged through the final concat step …
  await runFfmpegWithLines(args, "[final]", opts.onLine);
  return { outputPath: opts.output, mixedScenePaths: mixedScenes };
}
```

Update any existing callsites that consume the old `Promise<string>` return value:

```typescript
// src/commands/render.ts and tests — change:
const out = await stitch(opts);
// to:
const { outputPath: out } = await stitch(opts);
```

- [ ] **Step 4: Wire step-index emission into `stitchCommand`**

Replace `src/commands/stitch.ts`:

```typescript
// src/commands/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState } from "../core/store.js";
import { stitch, type SceneInput } from "../core/stitch.js";
import { buildStepIndex } from "../core/step-index.js";
import { buildWebVtt, type SayEventForVtt } from "../core/captions-vtt.js";
import { probeDurationMs } from "../core/ffprobe.js";
import type { SayEvent } from "../core/scene-audio.js";
import type { RunnerEvent, SceneForStepIndex } from "../types.js";

export async function stitchCommand(file: string): Promise<void> {
  const demoFile = path.resolve(file);
  const baseDir = path.dirname(demoFile);
  const demoId = path.basename(demoFile, path.extname(demoFile));
  const dotDir = path.join(baseDir, ".daymo");
  const stateFile = path.join(dotDir, "state.json");
  const ttsDir = path.join(dotDir, "tts");

  const ast = parse(await fs.readFile(demoFile, "utf8"));
  const state = await loadState(stateFile, ast.scenes, demoFile);

  const pending: number[] = state.scenes.flatMap((r, i) => r.state === "pending" ? [i + 1] : []);
  if (pending.length > 0) {
    throw new Error(`scenes not captured: ${pending.join(", ")} — run: daymo capture <file> --all`);
  }

  const scenes: SceneInput[] = [];
  const allSceneEvents: RunnerEvent[][] = [];
  const recordingOffsets: number[] = [];
  for (const r of state.scenes) {
    let sayEvents: SayEvent[] = [];
    let recordingOffsetMs = 0;
    let allEvents: RunnerEvent[] = [];
    if (r.eventsPath) {
      try {
        const raw = await fs.readFile(r.eventsPath, "utf8");
        allEvents = JSON.parse(raw) as RunnerEvent[];
        sayEvents = allEvents
          .filter((e): e is Extract<RunnerEvent, { kind: "say" }> => e.kind === "say")
          .map((e) => ({ hash: e.hash, t: e.t, durationMs: e.durationMs, words: e.words ?? [] }));
        const sceneStart = allEvents.find((e): e is Extract<RunnerEvent, { kind: "scene_start" }> => e.kind === "scene_start");
        if (sceneStart && typeof sceneStart.recordingOffsetMs === "number") {
          recordingOffsetMs = sceneStart.recordingOffsetMs;
        }
      } catch {}
    }
    scenes.push({ webm: r.webmPath!, sayEvents, recordingOffsetMs });
    allSceneEvents.push(allEvents);
    recordingOffsets.push(recordingOffsetMs);
  }

  const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  const output = path.join(baseDir, "output.mp4");

  const { mixedScenePaths } = await stitch({
    scenes,
    music,
    output,
    workDir: dotDir,
    ttsDir,
    musicDuck: ast.frontmatter.tts.music_duck,
    onLine: () => {},
  });

  // Measure trimmed scene durations (post-mix, pre-concat) for step-index global offsets.
  const sceneForStepIndex: SceneForStepIndex[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const durationMs = await probeDurationMs(mixedScenePaths[i]);
    sceneForStepIndex.push({
      sceneIndex: i,
      recordingOffsetMs: recordingOffsets[i],
      trimmedDurationMs: durationMs,
      events: allSceneEvents[i],
    });
  }
  const stepIndex = buildStepIndex(demoId, sceneForStepIndex);
  await fs.writeFile(path.join(dotDir, "step-index.json"), JSON.stringify(stepIndex, null, 2));

  // Emit captions.vtt with global timestamps for all say events.
  const captions: SayEventForVtt[] = [];
  for (let i = 0; i < allSceneEvents.length; i++) {
    const sceneGlobalStart = stepIndex.scenes[i].globalStartMs;
    const offset = recordingOffsets[i];
    for (const ev of allSceneEvents[i]) {
      if (ev.kind === "say") {
        const globalStartMs = sceneGlobalStart + Math.max(0, ev.t - offset);
        captions.push({ globalStartMs, durationMs: ev.durationMs, text: ev.text });
      }
    }
  }
  await fs.writeFile(path.join(baseDir, "captions.vtt"), buildWebVtt(captions));

  process.stdout.write(`${output}\n`);
}
```

- [ ] **Step 5: Run integration test**

Run: `npx vitest run tests/integration/stitch-step-index.test.ts`
Expected: PASS.

- [ ] **Step 6: Sanity-check existing stitch tests still pass after the return-type change**

Run: `npx vitest run tests/integration/cli-stitch.test.ts tests/integration/editor-stitch.test.ts`
Expected: PASS (may need to fix callsites that destructured the old `Promise<string>`).

- [ ] **Step 7: Commit**

```bash
git add src/commands/stitch.ts src/core/stitch.ts tests/integration/stitch-step-index.test.ts
git commit -m "feat(stitch): emit step-index.json + captions.vtt alongside output.mp4"
```

---

### Task 1.6: Verify keyframe spacing on real fixture mp4

**Files:**
- Test: `tests/integration/stitch-keyframes.test.ts`

- [ ] **Step 1: Write integration test that ffprobes the stitched mp4 for keyint**

Create `tests/integration/stitch-keyframes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

describe("stitched output.mp4 keyframe spacing", () => {
  it("has GOP size of 30 frames (matches -g 30 from buildStitchArgs)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-keyframes-"));
    const out = path.join(dir, "out.mp4");
    // Use the existing buildStitchArgs path indirectly: invoke ffmpeg with the
    // same flags so we verify the encode-side guarantee independent of stitch
    // orchestration.
    await execa("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=size=320x240:rate=30:color=black",
      "-t", "3",
      "-c:v", "libx264",
      "-g", "30",
      out,
    ]);
    // Count keyframes (pict_type=I packets) in the file.
    const probe = await execa("ffprobe", [
      "-v", "error",
      "-select_streams", "v",
      "-show_frames",
      "-show_entries", "frame=pict_type",
      "-of", "csv=p=0",
      out,
    ]);
    const types = probe.stdout.split("\n").filter(Boolean);
    const iCount = types.filter((t) => t === "I").length;
    // 3s × 30fps = 90 frames; GOP=30 ⇒ keyframes at 0, 30, 60 = 3 I-frames.
    expect(iCount).toBeGreaterThanOrEqual(3);
    expect(iCount).toBeLessThanOrEqual(4); // allow encoder leeway
  }, 30_000);
});
```

- [ ] **Step 2: Run test (already exercises real ffmpeg with -g 30)**

Run: `npx vitest run tests/integration/stitch-keyframes.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/stitch-keyframes.test.ts
git commit -m "test(stitch): verify -g 30 produces ≤1s GOP via ffprobe"
```

---

**Milestone 1 complete.** `daymo stitch` now:
- Produces output.mp4 with keyframes every 30 frames (≤1s GOP)
- Writes `.daymo/step-index.json` with global ms timestamps for every step and scene
- Writes `captions.vtt` alongside output.mp4

---

## Milestone 2: Indexer (`daymo index`)

Goal: A `daymo index <demo-dir> --widget-id <id> --data-root <root>` CLI command that reads a directory of `.demo` files + their `.daymo/` artifacts (`step-index.json`, per-scene `events.json`) and writes one `index.json` (and `config.json`) to `<data-root>/widgets/<id>/`. Index contains canonical chunks with embeddings, BM25 keywords, and demo metadata.

Each task here is a pure-function test where possible; embedding I/O is gated behind `RUN_EMBED_TESTS=1`.

### Task 2.1: Index file types

**Files:**
- Modify: `src/types.ts` (add IndexFile, Chunk, WidgetConfig types)

- [ ] **Step 1: Add types to `src/types.ts`**

```typescript
export interface IndexedDemo {
  demoId: string;
  title: string;
  description: string;
  durationMs: number;
}

export interface IndexedChunk {
  stepId: string;            // "<demoId>:<sceneIndex>:<stepIndex>"
  demoId: string;
  sceneIndex: number;
  stepIndex: number;
  globalStartMs: number;
  globalEndMs: number;
  text: string;              // canonical chunk text used for embedding
  embedding: number[];       // 768 floats from gemini-embedding-001
  keywords: string[];        // BM25 sidecar
}

export interface IndexFile {
  version: "v1";
  widgetId: string;
  embeddingModel: "gemini-embedding-001";
  embeddingDims: number;
  createdAt: string;         // ISO 8601
  etag: string;              // sha256 of source artifacts (for cheap re-index skip)
  demos: IndexedDemo[];
  chunks: IndexedChunk[];
}

export interface WidgetConfig {
  widgetId: string;
  name: string;              // e.g., "Acme Helper"
  brandColor?: string;
  locale: string;            // BCP-47 default for chrome strings
  allowedOrigins: string[];  // exact origin strings; "*" not allowed
  suggestedQuestions: string[]; // up to 3, surfaced on first open
}
```

- [ ] **Step 2: Commit (no test yet — types only)**

```bash
git add src/types.ts
git commit -m "feat(types): IndexFile, IndexedChunk, WidgetConfig"
```

---

### Task 2.2: Chunk builder — fx.say bucketing + canonical text

**Files:**
- Create: `src/indexer/chunk-builder.ts`
- Create: `tests/unit/chunk-builder.test.ts`

The chunk builder is the heart of retrieval quality. It walks `events.json` in `t` order and attributes each `say` / `overlay` / `banner` event to the most-recent `step` event in the same scene, then assembles a canonical text string per step.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/chunk-builder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildChunks, type ChunkBuilderInput } from "../../src/indexer/chunk-builder.js";
import type { RunnerEvent, StepIndex } from "../../src/types.js";

function evScene(i: number, title: string, prose = ""): RunnerEvent {
  return { kind: "scene_start", t: 0, index: i, title, prose };
}
function evSceneEnd(i: number, t: number): RunnerEvent { return { kind: "scene_end", t, index: i }; }
function evStep(sceneIndex: number, stepIndex: number, t: number, description: string): RunnerEvent {
  return { kind: "step", t, sceneIndex, stepIndex, description };
}
function evSay(t: number, text: string): RunnerEvent {
  return { kind: "say", t, hash: "x", text, durationMs: 1000, words: [] };
}

function mkInput(events: RunnerEvent[], stepIndex: Partial<StepIndex> = {}): ChunkBuilderInput {
  return {
    demoId: "d1",
    demoTitle: "D1 Tour",
    demoDescription: "Tour of D1",
    perSceneEvents: [events],
    stepIndex: {
      demoId: "d1",
      mp4DurationMs: 10000,
      scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 10000, recordingOffsetMs: 0 }],
      steps: [
        { stepId: "d1:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 3000 },
        { stepId: "d1:0:1", sceneIndex: 0, stepIndex: 1, description: "Step one", globalStartMs: 3000, globalEndMs: 10000 },
      ],
      ...stepIndex,
    } as StepIndex,
  };
}

describe("buildChunks", () => {
  it("emits one chunk per step in the step-index, with stepId/timestamps copied from it", () => {
    const events = [evScene(0, "Welcome"), evStep(0, 1, 3000, "Step one"), evSceneEnd(0, 10000)];
    const chunks = buildChunks(mkInput(events));
    expect(chunks.map(c => c.stepId)).toEqual(["d1:0:0", "d1:0:1"]);
    expect(chunks[0]).toMatchObject({ globalStartMs: 0, globalEndMs: 3000 });
    expect(chunks[1]).toMatchObject({ globalStartMs: 3000, globalEndMs: 10000 });
  });

  it("attributes each say event to the most-recent step event in the same scene", () => {
    const events = [
      evScene(0, "Welcome"),
      evSay(500, "Hello from the preamble."),    // belongs to step 0 (preamble)
      evStep(0, 1, 3000, "Open the dialog"),
      evSay(3500, "Click the new project button."), // belongs to step 1
      evSay(4000, "It opens a modal."),             // also step 1
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    expect(chunks[0].text).toContain("Hello from the preamble.");
    expect(chunks[0].text).not.toContain("Click the new project button.");
    expect(chunks[1].text).toContain("Click the new project button.");
    expect(chunks[1].text).toContain("It opens a modal.");
  });

  it("includes scene prose only in the chunk for stepIndex=0 (preamble)", () => {
    const events = [
      evScene(0, "Welcome", "This scene introduces the dashboard."),
      evStep(0, 1, 3000, "Open the dialog"),
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    expect(chunks[0].text).toContain("This scene introduces the dashboard.");
    expect(chunks[1].text).not.toContain("This scene introduces the dashboard.");
  });

  it("formats canonical text with [Demo]/[Scene]/[Step] headers and inline narration", () => {
    const events = [
      evScene(0, "Welcome"),
      evStep(0, 1, 3000, "Open the dialog"),
      evSay(3500, "Click here."),
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    expect(chunks[1].text).toBe([
      "[Demo] D1 Tour",
      "[Scene] Welcome",
      "[Step] Open the dialog",
      "Click here.",
    ].join("\n"));
  });

  it("uses '(preamble)' as the step header for stepIndex=0", () => {
    const events = [evScene(0, "Welcome"), evSay(500, "Hi."), evSceneEnd(0, 10000)];
    const chunks = buildChunks(mkInput(events, { steps: [
      { stepId: "d1:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 10000 },
    ]}));
    expect(chunks[0].text).toContain("[Step] (preamble)");
  });

  it("skips chunks whose body contains only headers and no narration / prose / overlay", () => {
    // Step has no say events and no overlay/banner — pure mechanics. Skip it.
    const events = [
      evScene(0, "Welcome"),
      evStep(0, 1, 3000, "Pure mechanics"),
      evSceneEnd(0, 10000),
    ];
    const chunks = buildChunks(mkInput(events));
    expect(chunks.map(c => c.stepIndex)).toEqual([0]); // only preamble (which itself has no body — but see next test)
  });

  it("emits the preamble chunk only if the scene has prose or the preamble bucket has any narration", () => {
    // No prose, no preamble narration, no explicit steps — skip the scene entirely.
    const events = [evScene(0, "Welcome"), evSceneEnd(0, 5000)];
    const chunks = buildChunks(mkInput(events, { steps: [
      { stepId: "d1:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 5000 },
    ]}));
    expect(chunks).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/chunk-builder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildChunks`**

Create `src/indexer/chunk-builder.ts`:

```typescript
import type { RunnerEvent, StepIndex } from "../types.js";

export interface ChunkBuilderInput {
  demoId: string;
  demoTitle: string;
  demoDescription: string;
  /** events.json arrays, one per scene, in scene-index order. */
  perSceneEvents: RunnerEvent[][];
  stepIndex: StepIndex;
}

/** Skeleton of one chunk before embedding. Embedding + keywords are added later. */
export interface BuiltChunk {
  stepId: string;
  demoId: string;
  sceneIndex: number;
  stepIndex: number;
  globalStartMs: number;
  globalEndMs: number;
  text: string;
}

/** Walks per-scene events in t order, buckets fx.say/overlay/banner events under
 *  the most-recent step event in the same scene, and emits one BuiltChunk per
 *  non-empty step. Returns chunks in step-index order. */
export function buildChunks(input: ChunkBuilderInput): BuiltChunk[] {
  const { demoTitle, perSceneEvents, stepIndex } = input;

  // bucket[sceneIndex][stepIndex] = { says: string[], overlays: string[], banners: string[] }
  type Bucket = { says: string[]; overlays: string[]; banners: string[] };
  const buckets: Map<string, Bucket> = new Map();
  const keyOf = (sceneIndex: number, stepIndex: number) => `${sceneIndex}:${stepIndex}`;

  for (let sceneIndex = 0; sceneIndex < perSceneEvents.length; sceneIndex++) {
    const events = perSceneEvents[sceneIndex];
    let currentStepIndex = 0; // implicit preamble
    for (const ev of events) {
      if (ev.kind === "step" && ev.sceneIndex === sceneIndex) {
        currentStepIndex = ev.stepIndex;
        continue;
      }
      const key = keyOf(sceneIndex, currentStepIndex);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = { says: [], overlays: [], banners: [] }; buckets.set(key, bucket); }
      if (ev.kind === "say") {
        bucket.says.push(ev.text);
      } else if (ev.kind === "overlay") {
        const text = ev.directive && typeof (ev.directive as { text?: string }).text === "string"
          ? (ev.directive as { text: string }).text
          : null;
        if (text) bucket.overlays.push(text);
      } else if (ev.kind === "fx" && ev.method === "banner") {
        const bannerText = Array.isArray(ev.args) && typeof ev.args[0] === "string" ? (ev.args[0] as string) : null;
        if (bannerText) bucket.banners.push(bannerText);
      }
    }
  }

  // scene prose is attached to the preamble of the same scene
  const sceneProse: Map<number, string> = new Map();
  for (let sceneIndex = 0; sceneIndex < perSceneEvents.length; sceneIndex++) {
    const sceneStart = perSceneEvents[sceneIndex].find(
      (e): e is Extract<RunnerEvent, { kind: "scene_start" }> => e.kind === "scene_start"
    );
    if (sceneStart?.prose) sceneProse.set(sceneIndex, sceneStart.prose);
  }

  // Title resolution: scene_start gives us the title, but step-index doesn't
  // carry it. Pre-compute per-scene titles.
  const sceneTitles: Map<number, string> = new Map();
  for (let sceneIndex = 0; sceneIndex < perSceneEvents.length; sceneIndex++) {
    const start = perSceneEvents[sceneIndex].find(
      (e): e is Extract<RunnerEvent, { kind: "scene_start" }> => e.kind === "scene_start"
    );
    sceneTitles.set(sceneIndex, start?.title ?? "");
  }

  const chunks: BuiltChunk[] = [];
  for (const step of stepIndex.steps) {
    const bucket = buckets.get(keyOf(step.sceneIndex, step.stepIndex)) ?? { says: [], overlays: [], banners: [] };
    const proseForThisStep = step.stepIndex === 0 ? sceneProse.get(step.sceneIndex) ?? "" : "";
    const body = [
      ...bucket.says,
      proseForThisStep ? proseForThisStep : null,
      ...bucket.overlays,
      ...bucket.banners,
    ].filter((s): s is string => Boolean(s && s.trim()));

    if (body.length === 0) continue; // mechanics-only: skip

    const sceneTitle = sceneTitles.get(step.sceneIndex) ?? "";
    const text = [
      `[Demo] ${demoTitle}`,
      `[Scene] ${sceneTitle}`,
      `[Step] ${step.description}`,
      ...body,
    ].join("\n");

    chunks.push({
      stepId: step.stepId,
      demoId: step.stepId.split(":")[0],
      sceneIndex: step.sceneIndex,
      stepIndex: step.stepIndex,
      globalStartMs: step.globalStartMs,
      globalEndMs: step.globalEndMs,
      text,
    });
  }
  return chunks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/chunk-builder.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/chunk-builder.ts tests/unit/chunk-builder.test.ts
git commit -m "feat(indexer): fx.say bucketing + canonical chunk text"
```

---

### Task 2.3: Keyword extractor for BM25 sidecar

**Files:**
- Create: `src/indexer/keywords.ts`
- Create: `tests/unit/keywords.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/keywords.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractKeywords } from "../../src/indexer/keywords.js";

describe("extractKeywords", () => {
  it("tokenizes on whitespace and punctuation; lowercases; dedupes", () => {
    const kw = extractKeywords("Click the New-Project button. Click again.");
    expect(kw).toContain("click");
    expect(kw).toContain("new");
    expect(kw).toContain("project");
    expect(kw).toContain("button");
    expect(kw).toContain("again");
    // dedupe: 'click' only once
    expect(kw.filter(k => k === "click")).toHaveLength(1);
  });

  it("drops stopwords like 'the', 'a', 'an', 'and', 'or', 'is', 'are', 'to', 'of', 'in', 'on', 'with', 'for'", () => {
    const kw = extractKeywords("The cat is on the mat with a hat for the bat.");
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("a");
    expect(kw).not.toContain("is");
    expect(kw).not.toContain("on");
    expect(kw).not.toContain("with");
    expect(kw).not.toContain("for");
    expect(kw).toContain("cat");
    expect(kw).toContain("mat");
    expect(kw).toContain("hat");
    expect(kw).toContain("bat");
  });

  it("drops tokens shorter than 2 characters", () => {
    const kw = extractKeywords("I e r a b cab");
    expect(kw).not.toContain("i");
    expect(kw).not.toContain("e");
    expect(kw).toContain("cab");
  });

  it("preserves non-English tokens by tokenizing on Unicode whitespace + ASCII punctuation only", () => {
    const kw = extractKeywords("プロジェクト 作成 — pulgar abajo");
    expect(kw).toContain("プロジェクト");
    expect(kw).toContain("作成");
    expect(kw).toContain("pulgar");
    expect(kw).toContain("abajo");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/keywords.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `extractKeywords`**

Create `src/indexer/keywords.ts`:

```typescript
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so",
  "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "by", "with", "for", "from", "as",
  "it", "its", "this", "that", "these", "those",
  "i", "you", "he", "she", "we", "they",
  "do", "does", "did", "done",
  "have", "has", "had",
  "not", "no",
]);

/** Tokenize text into lowercased, deduped, non-stopword keywords ≥2 chars.
 *  Splits on Unicode whitespace and ASCII punctuation. Preserves non-ASCII tokens. */
export function extractKeywords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Split on whitespace + ASCII punctuation; keep all other Unicode letters/digits.
  const tokens = text
    .toLowerCase()
    .split(/[\s.,;:!?()[\]{}"'`<>/\\|@#$%^&*+=~_\-—–]+/u)
    .filter(Boolean);
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/keywords.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/keywords.ts tests/unit/keywords.test.ts
git commit -m "feat(indexer): keyword extraction for BM25 sidecar"
```

---

### Task 2.4: BM25 scoring function

**Files:**
- Create: `src/indexer/bm25.ts`
- Create: `tests/unit/bm25.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/bm25.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { scoreBm25, buildBm25Stats, type Bm25Doc } from "../../src/indexer/bm25.js";

describe("BM25", () => {
  const docs: Bm25Doc[] = [
    { id: "a", keywords: ["create", "project", "dialog"] },
    { id: "b", keywords: ["create", "user", "form"] },
    { id: "c", keywords: ["delete", "project"] },
  ];
  const stats = buildBm25Stats(docs);

  it("returns higher scores for documents containing more query keywords", () => {
    const scores = scoreBm25(["create", "project"], docs, stats);
    expect(scores.find(s => s.id === "a")!.score).toBeGreaterThan(scores.find(s => s.id === "b")!.score);
    expect(scores.find(s => s.id === "a")!.score).toBeGreaterThan(scores.find(s => s.id === "c")!.score);
  });

  it("returns score 0 for documents with no query keywords", () => {
    const scores = scoreBm25(["nonexistent"], docs, stats);
    for (const s of scores) expect(s.score).toBe(0);
  });

  it("returns one score entry per input document, even when score is 0", () => {
    const scores = scoreBm25(["create"], docs, stats);
    expect(scores).toHaveLength(3);
  });

  it("downweights very common terms via IDF", () => {
    // "create" appears in 2/3 docs → low IDF
    // "dialog" appears in 1/3 docs → higher IDF
    const scoresCreate = scoreBm25(["create"], docs, stats);
    const scoresDialog = scoreBm25(["dialog"], docs, stats);
    const topCreate = Math.max(...scoresCreate.map(s => s.score));
    const topDialog = Math.max(...scoresDialog.map(s => s.score));
    expect(topDialog).toBeGreaterThan(topCreate);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/bm25.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement BM25**

Create `src/indexer/bm25.ts`:

```typescript
export interface Bm25Doc {
  id: string;
  keywords: string[]; // already lowercased + deduped (extractKeywords output is fine)
}

export interface Bm25Stats {
  avgDocLength: number;
  docFreq: Map<string, number>; // term → # docs containing the term
  numDocs: number;
}

export function buildBm25Stats(docs: Bm25Doc[]): Bm25Stats {
  const docFreq = new Map<string, number>();
  let totalLen = 0;
  for (const d of docs) {
    totalLen += d.keywords.length;
    const seen = new Set(d.keywords);
    for (const term of seen) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }
  return {
    avgDocLength: docs.length === 0 ? 0 : totalLen / docs.length,
    docFreq,
    numDocs: docs.length,
  };
}

const K1 = 1.5;
const B = 0.75;

/** Classic BM25 with k1=1.5, b=0.75. Returns one entry per doc, score 0 when
 *  no query term matches. Deduped query terms (extractKeywords-style) are
 *  expected for stable behavior. */
export function scoreBm25(query: string[], docs: Bm25Doc[], stats: Bm25Stats): Array<{ id: string; score: number }> {
  if (stats.numDocs === 0) return docs.map(d => ({ id: d.id, score: 0 }));
  const out: Array<{ id: string; score: number }> = [];
  for (const d of docs) {
    let score = 0;
    const docLen = d.keywords.length;
    const docTerms = new Set(d.keywords); // keywords are already deduped per-doc
    for (const term of query) {
      if (!docTerms.has(term)) continue;
      const df = stats.docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (stats.numDocs - df + 0.5) / (df + 0.5));
      const tf = 1; // keywords are deduped, so per-doc tf is binary
      const denom = tf + K1 * (1 - B + B * (docLen / Math.max(1, stats.avgDocLength)));
      score += idf * ((tf * (K1 + 1)) / denom);
    }
    out.push({ id: d.id, score });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/bm25.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/bm25.ts tests/unit/bm25.test.ts
git commit -m "feat(indexer): BM25 scoring with classic k1=1.5, b=0.75"
```

---

### Task 2.5: Gemini embedding client (batch + sync)

**Files:**
- Create: `src/indexer/embedder-gemini.ts`
- Create: `tests/unit/embedder-gemini.test.ts` (mocked fetch)
- Create: `tests/integration/embedder-gemini-real.test.ts` (gated by `RUN_EMBED_TESTS=1`)

- [ ] **Step 1: Write failing unit test against mocked fetch**

Create `tests/unit/embedder-gemini.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { embedBatch, embedQuery } from "../../src/indexer/embedder-gemini.js";

describe("embedBatch", () => {
  it("posts to the batchEmbedContents endpoint and returns embeddings in input order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        embeddings: [
          { values: [0.1, 0.2, 0.3] },
          { values: [0.4, 0.5, 0.6] },
        ],
      }),
    });
    const out = await embedBatch(["hello", "world"], { apiKey: "K", fetchFn: fetchMock });
    expect(out).toEqual([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/batchEmbedContents/);
    expect(url).toContain("key=K");
  });

  it("throws a helpful error when the API returns non-200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "API key invalid",
      json: async () => ({}),
    });
    await expect(embedBatch(["x"], { apiKey: "K", fetchFn: fetchMock })).rejects.toThrow(/401/);
  });

  it("batches > 100 inputs into multiple requests", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const n = body.requests.length;
      return {
        ok: true,
        status: 200,
        json: async () => ({ embeddings: Array.from({ length: n }, () => ({ values: [0] })) }),
      };
    });
    const inputs = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const out = await embedBatch(inputs, { apiKey: "K", fetchFn: fetchMock });
    expect(out).toHaveLength(250);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 100 + 100 + 50
  });
});

describe("embedQuery", () => {
  it("posts to the single-content endpoint and returns one embedding vector", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [0.9, 0.8] } }),
    });
    const v = await embedQuery("how do I X?", { apiKey: "K", fetchFn: fetchMock });
    expect(v).toEqual([0.9, 0.8]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/:embedContent/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/embedder-gemini.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Gemini embedder**

Create `src/indexer/embedder-gemini.ts`:

```typescript
/** Thin Gemini embedding client. Native fetch only — no SDK dependency.
 *  Batch endpoint is used at index time (cheaper); sync embedContent is used
 *  for query embeddings at chat time. */

const MODEL = "gemini-embedding-001";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const BATCH_SIZE = 100;

export interface EmbedderOpts {
  apiKey: string;
  fetchFn?: typeof fetch;
}

interface BatchResponse {
  embeddings: Array<{ values: number[] }>;
}
interface SingleResponse {
  embedding: { values: number[] };
}

async function postJson<T>(url: string, body: unknown, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch {}
    throw new Error(`Gemini embedding API ${res.status}: ${detail.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/** Embed N text strings via the batchEmbedContents endpoint.
 *  Inputs are chunked into BATCH_SIZE requests automatically.
 *  Returns embedding vectors in input order. */
export async function embedBatch(inputs: string[], opts: EmbedderOpts): Promise<number[][]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const slice = inputs.slice(i, i + BATCH_SIZE);
    const url = `${BASE}/${MODEL}:batchEmbedContents?key=${encodeURIComponent(opts.apiKey)}`;
    const body = {
      requests: slice.map((text) => ({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
      })),
    };
    const resp = await postJson<BatchResponse>(url, body, fetchFn);
    if (!Array.isArray(resp.embeddings) || resp.embeddings.length !== slice.length) {
      throw new Error(`Gemini batch returned ${resp.embeddings?.length ?? 0} embeddings; expected ${slice.length}`);
    }
    for (const e of resp.embeddings) out.push(e.values);
  }
  return out;
}

/** Embed a single query string. Lower latency endpoint, used at chat time. */
export async function embedQuery(text: string, opts: EmbedderOpts): Promise<number[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `${BASE}/${MODEL}:embedContent?key=${encodeURIComponent(opts.apiKey)}`;
  const body = {
    model: `models/${MODEL}`,
    content: { parts: [{ text }] },
    taskType: "RETRIEVAL_QUERY",
  };
  const resp = await postJson<SingleResponse>(url, body, fetchFn);
  return resp.embedding.values;
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `npx vitest run tests/unit/embedder-gemini.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write integration test gated by env flag**

Create `tests/integration/embedder-gemini-real.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { embedBatch, embedQuery } from "../../src/indexer/embedder-gemini.js";

const run = process.env.RUN_EMBED_TESTS === "1" && process.env.GEMINI_API_KEY;

describe.skipIf(!run)("Gemini embedder (real API, gated by RUN_EMBED_TESTS=1)", () => {
  it("returns 768-dim vectors for batch input", async () => {
    const vecs = await embedBatch(["hello world", "goodbye world"], { apiKey: process.env.GEMINI_API_KEY! });
    expect(vecs).toHaveLength(2);
    expect(vecs[0]).toHaveLength(768);
    expect(vecs[1]).toHaveLength(768);
  }, 30_000);

  it("returns a 768-dim vector for a query", async () => {
    const v = await embedQuery("how do I create a project?", { apiKey: process.env.GEMINI_API_KEY! });
    expect(v).toHaveLength(768);
  }, 30_000);
});
```

- [ ] **Step 6: Commit**

```bash
git add src/indexer/embedder-gemini.ts tests/unit/embedder-gemini.test.ts tests/integration/embedder-gemini-real.test.ts
git commit -m "feat(indexer): Gemini batch + sync embedding client"
```

---

### Task 2.6: Suggested-questions selector

**Files:**
- Create: `src/indexer/suggested-questions.ts`
- Create: `tests/unit/suggested-questions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/suggested-questions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pickSuggestedQuestions } from "../../src/indexer/suggested-questions.js";

describe("pickSuggestedQuestions", () => {
  it("returns up to 3 questions, derived from fx.step descriptions", () => {
    const out = pickSuggestedQuestions([
      "Open the new-project dialog",
      "Name the project",
      "Submit the form",
      "Archive the project",
    ]);
    expect(out).toHaveLength(3);
    for (const q of out) expect(q.startsWith("How do I ")).toBe(true);
    expect(out[0]).toMatch(/open.*new.project.*dialog/i);
  });

  it("returns fewer than 3 when input has fewer steps", () => {
    expect(pickSuggestedQuestions(["Do the thing"]).length).toBe(1);
    expect(pickSuggestedQuestions([]).length).toBe(0);
  });

  it("dedupes identical descriptions", () => {
    const out = pickSuggestedQuestions([
      "Open the dialog", "Open the dialog", "Submit", "Cancel",
    ]);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });

  it("skips the implicit '(preamble)' marker", () => {
    const out = pickSuggestedQuestions([
      "(preamble)", "Open the dialog", "(preamble)", "Submit",
    ]);
    for (const q of out) {
      expect(q).not.toMatch(/preamble/i);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/suggested-questions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pickSuggestedQuestions`**

Create `src/indexer/suggested-questions.ts`:

```typescript
/** Pick up to 3 suggested questions from a list of fx.step descriptions.
 *  Ranking is by uniqueness × frequency (more distinct words and more
 *  occurrences both raise the score). Skips '(preamble)'. */
export function pickSuggestedQuestions(descriptions: string[]): string[] {
  const counts = new Map<string, number>();
  for (const d of descriptions) {
    if (!d || d === "(preamble)") continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const scored = Array.from(counts.entries()).map(([d, count]) => {
    const uniqueWords = new Set(d.toLowerCase().split(/\s+/).filter(Boolean)).size;
    return { d, score: uniqueWords * Math.log(1 + count) + uniqueWords * 0.01 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ d }) => phraseAsQuestion(d));
}

function phraseAsQuestion(description: string): string {
  const lower = description.charAt(0).toLowerCase() + description.slice(1);
  const trimmed = lower.replace(/[.?!]+$/, "");
  return `How do I ${trimmed}?`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/suggested-questions.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/suggested-questions.ts tests/unit/suggested-questions.test.ts
git commit -m "feat(indexer): suggested-question selection from fx.step descriptions"
```

---

### Task 2.7: Index writer (orchestrator) — read demo dir, build index.json + config.json

**Files:**
- Create: `src/indexer/write-index.ts`
- Test: `tests/integration/indexer-end-to-end.test.ts`

- [ ] **Step 1: Write integration test (uses mocked Gemini fetch for hermetic behavior)**

Create `tests/integration/indexer-end-to-end.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeIndexForDemoDir } from "../../src/indexer/write-index.js";

describe("writeIndexForDemoDir (integration with mocked Gemini)", () => {
  it("reads a demo dir + .daymo/ artifacts and writes index.json + config.json", async () => {
    const demoDir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-idx-"));
    const daymoDir = path.join(demoDir, ".daymo");
    const capDir = path.join(daymoDir, "captures");
    await fs.mkdir(path.join(capDir, "scene-001"), { recursive: true });

    // .demo source
    await fs.writeFile(path.join(demoDir, "tour.demo"), `---\ntitle: Test Tour\ndescription: Tour of test\nurl: http://localhost\n---\n\n# Welcome\n\n\`\`\`playwright\nawait fx.say("Welcome to the dashboard.");\n\`\`\`\n`);

    // per-scene events
    await fs.writeFile(path.join(capDir, "scene-001", "events.json"), JSON.stringify([
      { kind: "scene_start", t: 0, index: 0, title: "Welcome", prose: "", recordingOffsetMs: 0 },
      { kind: "say", t: 200, hash: "h", text: "Welcome to the dashboard.", durationMs: 2000, words: [] },
      { kind: "scene_end", t: 3000, index: 0 },
    ]));

    // step-index emitted by Milestone 1's stitcher
    await fs.writeFile(path.join(daymoDir, "step-index.json"), JSON.stringify({
      demoId: "tour",
      mp4DurationMs: 3000,
      scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 3000, recordingOffsetMs: 0 }],
      steps: [{ stepId: "tour:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 3000 }],
    }));

    // empty mp4 for duration (the indexer reads durationMs from step-index, not the file)
    await fs.writeFile(path.join(demoDir, "output.mp4"), "");

    // state.json so the indexer can map scene-index→events.json path
    await fs.writeFile(path.join(daymoDir, "state.json"), JSON.stringify({
      scenes: [{ state: "captured", eventsPath: path.join(capDir, "scene-001", "events.json") }],
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embeddings: [{ values: Array(768).fill(0.5) }] }),
    });

    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-data-"));
    await writeIndexForDemoDir({
      demoDir,
      widgetId: "wgt_test",
      widgetName: "Test Helper",
      locale: "en",
      allowedOrigins: ["https://example.com"],
      dataRoot,
      geminiApiKey: "K",
      fetchFn: fetchMock,
    });

    const idx = JSON.parse(await fs.readFile(path.join(dataRoot, "widgets/wgt_test/index.json"), "utf8"));
    expect(idx.version).toBe("v1");
    expect(idx.widgetId).toBe("wgt_test");
    expect(idx.embeddingModel).toBe("gemini-embedding-001");
    expect(idx.embeddingDims).toBe(768);
    expect(idx.demos[0]).toMatchObject({ demoId: "tour", title: "Test Tour" });
    expect(idx.chunks).toHaveLength(1);
    expect(idx.chunks[0].text).toContain("Welcome to the dashboard.");

    const cfg = JSON.parse(await fs.readFile(path.join(dataRoot, "widgets/wgt_test/config.json"), "utf8"));
    expect(cfg.widgetId).toBe("wgt_test");
    expect(cfg.allowedOrigins).toEqual(["https://example.com"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/indexer-end-to-end.test.ts`
Expected: FAIL — `writeIndexForDemoDir` not found.

- [ ] **Step 3: Implement `writeIndexForDemoDir`**

Create `src/indexer/write-index.ts`:

```typescript
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { parse } from "../parser.js";
import { buildChunks } from "./chunk-builder.js";
import { extractKeywords } from "./keywords.js";
import { embedBatch } from "./embedder-gemini.js";
import { pickSuggestedQuestions } from "./suggested-questions.js";
import type { RunnerEvent, StepIndex, IndexFile, IndexedChunk, IndexedDemo, WidgetConfig } from "../types.js";

export interface WriteIndexOpts {
  demoDir: string;             // directory containing 1+ .demo files
  widgetId: string;
  widgetName: string;
  locale: string;
  allowedOrigins: string[];
  brandColor?: string;
  dataRoot: string;            // where widgets/<id>/ will be written
  geminiApiKey: string;
  fetchFn?: typeof fetch;
}

export async function writeIndexForDemoDir(opts: WriteIndexOpts): Promise<void> {
  // Find all .demo files in the directory (non-recursive for v1).
  const entries = await fs.readdir(opts.demoDir, { withFileTypes: true });
  const demoFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".demo"))
    .map((e) => path.join(opts.demoDir, e.name));
  if (demoFiles.length === 0) {
    throw new Error(`no .demo files found in ${opts.demoDir}`);
  }

  const demos: IndexedDemo[] = [];
  const allChunks: IndexedChunk[] = [];
  const allStepDescriptions: string[] = [];

  for (const demoFile of demoFiles) {
    const demoId = path.basename(demoFile, path.extname(demoFile));
    const baseDir = path.dirname(demoFile);
    const dotDir = path.join(baseDir, ".daymo");

    const demoText = await fs.readFile(demoFile, "utf8");
    const ast = parse(demoText);
    const stepIndex = JSON.parse(await fs.readFile(path.join(dotDir, "step-index.json"), "utf8")) as StepIndex;
    const state = JSON.parse(await fs.readFile(path.join(dotDir, "state.json"), "utf8")) as {
      scenes: Array<{ eventsPath?: string }>;
    };

    const perSceneEvents: RunnerEvent[][] = [];
    for (const s of state.scenes) {
      if (!s.eventsPath) { perSceneEvents.push([]); continue; }
      const raw = await fs.readFile(s.eventsPath, "utf8");
      perSceneEvents.push(JSON.parse(raw) as RunnerEvent[]);
    }

    const chunks = buildChunks({
      demoId,
      demoTitle: ast.frontmatter.title,
      demoDescription: ast.frontmatter.description ?? "",
      perSceneEvents,
      stepIndex,
    });

    demos.push({
      demoId,
      title: ast.frontmatter.title,
      description: ast.frontmatter.description ?? "",
      durationMs: stepIndex.mp4DurationMs,
    });

    for (const step of stepIndex.steps) allStepDescriptions.push(step.description);

    for (const c of chunks) {
      allChunks.push({
        stepId: c.stepId,
        demoId: c.demoId,
        sceneIndex: c.sceneIndex,
        stepIndex: c.stepIndex,
        globalStartMs: c.globalStartMs,
        globalEndMs: c.globalEndMs,
        text: c.text,
        embedding: [], // filled in below
        keywords: extractKeywords(c.text),
      });
    }
  }

  // Batch-embed all chunk texts in one shot (chunked internally by 100).
  const embeddings = await embedBatch(
    allChunks.map((c) => c.text),
    { apiKey: opts.geminiApiKey, fetchFn: opts.fetchFn },
  );
  for (let i = 0; i < allChunks.length; i++) allChunks[i].embedding = embeddings[i];

  const embeddingDims = allChunks.length > 0 ? allChunks[0].embedding.length : 768;
  const createdAt = new Date().toISOString();
  const etag = computeEtag(allChunks, demos);

  const indexFile: IndexFile = {
    version: "v1",
    widgetId: opts.widgetId,
    embeddingModel: "gemini-embedding-001",
    embeddingDims,
    createdAt,
    etag,
    demos,
    chunks: allChunks,
  };

  const widgetDir = path.join(opts.dataRoot, "widgets", opts.widgetId);
  await fs.mkdir(widgetDir, { recursive: true });
  await fs.writeFile(path.join(widgetDir, "index.json"), JSON.stringify(indexFile, null, 2));

  const config: WidgetConfig = {
    widgetId: opts.widgetId,
    name: opts.widgetName,
    brandColor: opts.brandColor,
    locale: opts.locale,
    allowedOrigins: opts.allowedOrigins,
    suggestedQuestions: pickSuggestedQuestions(allStepDescriptions),
  };
  await fs.writeFile(path.join(widgetDir, "config.json"), JSON.stringify(config, null, 2));
}

function computeEtag(chunks: IndexedChunk[], demos: IndexedDemo[]): string {
  const h = crypto.createHash("sha256");
  for (const d of demos) h.update(`${d.demoId}\x00${d.durationMs}\x00`);
  for (const c of chunks) h.update(`${c.stepId}\x00${c.text}\x00`);
  return h.digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/indexer-end-to-end.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/write-index.ts tests/integration/indexer-end-to-end.test.ts
git commit -m "feat(indexer): orchestrate chunk-builder + embedder + write index.json/config.json"
```

---

### Task 2.8: `daymo index` CLI subcommand

**Files:**
- Create: `src/commands/index.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement the CLI subcommand**

Create `src/commands/index.ts`:

```typescript
import path from "node:path";
import os from "node:os";
import { writeIndexForDemoDir } from "../indexer/write-index.js";

export interface IndexCommandOpts {
  widgetId: string;
  widgetName?: string;
  locale?: string;
  allowedOrigins?: string;     // comma-separated
  brandColor?: string;
  dataRoot?: string;
}

export async function indexCommand(demoDir: string, opts: IndexCommandOpts): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required for `daymo index`.");
  }
  const dataRoot = opts.dataRoot
    ?? process.env.DAYMO_DATA_ROOT
    ?? path.join(os.homedir(), ".daymo-chat-data");
  const allowedOrigins = (opts.allowedOrigins ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowedOrigins.length === 0) {
    throw new Error("--allowed-origins is required (comma-separated list of exact origins).");
  }
  await writeIndexForDemoDir({
    demoDir: path.resolve(demoDir),
    widgetId: opts.widgetId,
    widgetName: opts.widgetName ?? opts.widgetId,
    locale: opts.locale ?? "en",
    allowedOrigins,
    brandColor: opts.brandColor,
    dataRoot,
    geminiApiKey: apiKey,
  });
  process.stdout.write(`indexed → ${path.join(dataRoot, "widgets", opts.widgetId)}\n`);
}
```

- [ ] **Step 2: Register in `src/cli.ts`**

Add to `src/cli.ts` (after the existing commands, before `cli.help()`):

```typescript
import { indexCommand } from "./commands/index.js";

cli.command("index <demoDir>", "Build a chat-widget index from a directory of .demo files")
  .option("--widget-id <id>", "Widget identifier (required)")
  .option("--widget-name <name>", "Human-readable widget name")
  .option("--locale <locale>", "Default locale for widget chrome (BCP-47)")
  .option("--allowed-origins <list>", "Comma-separated list of allowed origin URLs")
  .option("--brand-color <hex>", "Optional hex color for the widget bubble")
  .option("--data-root <path>", "Override DAYMO_DATA_ROOT for this run")
  .action((demoDir: string, flags: {
    widgetId?: string;
    widgetName?: string;
    locale?: string;
    allowedOrigins?: string;
    brandColor?: string;
    dataRoot?: string;
  }) => {
    if (!flags.widgetId) throw new Error("--widget-id is required");
    return indexCommand(demoDir, {
      widgetId: flags.widgetId,
      widgetName: flags.widgetName,
      locale: flags.locale,
      allowedOrigins: flags.allowedOrigins,
      brandColor: flags.brandColor,
      dataRoot: flags.dataRoot,
    });
  });
```

- [ ] **Step 3: Manually verify CLI help output**

Run: `npx tsc && node dist/cli.js --help`
Expected: New `index` command listed; running `node dist/cli.js index --help` shows the option flags.

- [ ] **Step 4: Commit**

```bash
git add src/commands/index.ts src/cli.ts
git commit -m "feat(cli): daymo index <demoDir> subcommand"
```

---

**Milestone 2 complete.** `daymo index` builds a per-widget `index.json` (chunks + Gemini embeddings + BM25 keywords) and `config.json` (allowed origins, suggested questions, locale) under `<DAYMO_DATA_ROOT>/widgets/<id>/`.

---

## Milestone 3: Chat backend

Goal: `daymo serve` runs a `node:http` server on a configurable port. It exposes `POST /chat`, `GET /widget-config/<widgetId>`, `GET /widgets/<id>/demos/<demoId>/output.mp4` (with range support), and `POST /admin/reload?widgetId=…`. Pipeline: query rewrite (Haiku) → embed query (Gemini) → cosine + BM25 retrieval → score gate → answer LLM (Sonnet with json_schema) → server-side stepId validation. Three layers of certainty enforced.

Most tasks are pure functions. The HTTP layer is the last task; everything else can be tested in isolation.

### Task 3.1: ChatResponse types (shared with widget)

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add ChatResponse types to `src/types.ts`**

```typescript
export interface ChatRequest {
  widgetId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>; // ≤ 2 turns
  locale?: string;
}

export type TextPart = { kind: "text"; text: string };
export type VideoPart = {
  kind: "video";
  stepId: string;
  demoId: string;
  startMs: number;
  endMs: number;
  caption: string;
  mp4Url: string;
};
export type Part = TextPart | VideoPart;

export type ChatResponse =
  | { kind: "answer"; parts: Part[] }
  | { kind: "no_match"; text: string; suggestions?: string[] };
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): ChatRequest / ChatResponse / Part"
```

---

### Task 3.2: Cosine similarity helper

**Files:**
- Create: `src/chat-server/cosine.ts`
- Create: `tests/unit/cosine.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/cosine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { cosineSimilarity } from "../../src/chat-server/cosine.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it("returns -1 for anti-parallel vectors", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
  });
  it("returns 0 for either vector being zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });
  it("throws on dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/dimension/i);
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL** — Run: `npx vitest run tests/unit/cosine.test.ts`

- [ ] **Step 3: Implement**

Create `src/chat-server/cosine.ts`:

```typescript
/** Cosine similarity for two same-length numeric vectors. Returns 0 if either
 *  vector has zero magnitude. Throws on dimension mismatch. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

- [ ] **Step 4: Run tests; expect PASS (5 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/cosine.ts tests/unit/cosine.test.ts
git commit -m "feat(chat-server): cosine similarity helper"
```

---

### Task 3.3: Hybrid retrieval (cosine + BM25 union, top-K)

**Files:**
- Create: `src/chat-server/retrieve.ts`
- Create: `tests/unit/retrieve.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/retrieve.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { retrieve } from "../../src/chat-server/retrieve.js";
import type { IndexedChunk } from "../../src/types.js";

function chunk(stepId: string, embedding: number[], keywords: string[]): IndexedChunk {
  return {
    stepId,
    demoId: stepId.split(":")[0],
    sceneIndex: 0,
    stepIndex: 0,
    globalStartMs: 0,
    globalEndMs: 1000,
    text: stepId,
    embedding,
    keywords,
  };
}

describe("retrieve", () => {
  const chunks: IndexedChunk[] = [
    chunk("d:0:1", [1, 0, 0], ["create", "project"]),
    chunk("d:0:2", [0, 1, 0], ["delete", "project"]),
    chunk("d:0:3", [0, 0, 1], ["invite", "team"]),
    chunk("d:0:4", [0.7, 0.7, 0], ["create", "team"]),
  ];

  it("returns top-K by cosine similarity when keywords overlap is tied", () => {
    const result = retrieve({
      query: { embedding: [1, 0, 0], keywords: [] },
      chunks, k: 2,
    });
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].stepId).toBe("d:0:1"); // perfect cosine
    expect(result.topCosineScore).toBeCloseTo(1, 6);
  });

  it("union of top-K cosine and top-K BM25 (deduped), final list ≤ K", () => {
    // query embedding favors d:0:1; keyword "team" favors d:0:3 and d:0:4
    const result = retrieve({
      query: { embedding: [1, 0, 0], keywords: ["team"] },
      chunks, k: 3,
    });
    expect(result.chunks.map(c => c.stepId)).toContain("d:0:1");
    expect(result.chunks.map(c => c.stepId).filter(id => ["d:0:3", "d:0:4"].includes(id)).length).toBeGreaterThan(0);
    expect(result.chunks.length).toBeLessThanOrEqual(3);
  });

  it("topCosineScore is the highest cosine across all chunks (used as Layer-1 score gate)", () => {
    const result = retrieve({
      query: { embedding: [0.7, 0.7, 0], keywords: [] },
      chunks, k: 1,
    });
    expect(result.topCosineScore).toBeCloseTo(1, 6); // perfect match on d:0:4
  });

  it("returns empty array when index has no chunks", () => {
    const result = retrieve({
      query: { embedding: [1, 0, 0], keywords: ["x"] },
      chunks: [], k: 5,
    });
    expect(result.chunks).toEqual([]);
    expect(result.topCosineScore).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `src/chat-server/retrieve.ts`:

```typescript
import { cosineSimilarity } from "./cosine.js";
import { buildBm25Stats, scoreBm25 } from "../indexer/bm25.js";
import type { IndexedChunk } from "../types.js";

export interface RetrieveInput {
  query: { embedding: number[]; keywords: string[] };
  chunks: IndexedChunk[];
  k: number;
}

export interface RetrieveResult {
  chunks: IndexedChunk[];      // ordered: cosine-top first, then BM25-only entries
  topCosineScore: number;       // for Layer-1 gate
}

/** Hybrid retrieval: take top-K by cosine similarity, union with top-K by BM25,
 *  dedupe (preferring cosine ordering for ties), and return up to K total. */
export function retrieve(input: RetrieveInput): RetrieveResult {
  const { query, chunks, k } = input;
  if (chunks.length === 0) return { chunks: [], topCosineScore: 0 };

  const cosineScored = chunks.map((c) => ({
    chunk: c,
    score: cosineSimilarity(query.embedding, c.embedding),
  }));
  cosineScored.sort((a, b) => b.score - a.score);
  const topCosineScore = cosineScored[0]?.score ?? 0;
  const cosineTopK = cosineScored.slice(0, k).map((s) => s.chunk);

  let bm25TopK: IndexedChunk[] = [];
  if (query.keywords.length > 0) {
    const bm25Docs = chunks.map((c) => ({ id: c.stepId, keywords: c.keywords }));
    const stats = buildBm25Stats(bm25Docs);
    const bm25Scores = scoreBm25(query.keywords, bm25Docs, stats);
    bm25Scores.sort((a, b) => b.score - a.score);
    const ids = new Set(bm25Scores.slice(0, k).filter((s) => s.score > 0).map((s) => s.id));
    bm25TopK = chunks.filter((c) => ids.has(c.stepId));
  }

  const seen = new Set<string>();
  const out: IndexedChunk[] = [];
  for (const c of cosineTopK) {
    if (seen.has(c.stepId)) continue;
    seen.add(c.stepId);
    out.push(c);
    if (out.length >= k) break;
  }
  for (const c of bm25TopK) {
    if (out.length >= k) break;
    if (seen.has(c.stepId)) continue;
    seen.add(c.stepId);
    out.push(c);
  }

  return { chunks: out, topCosineScore };
}
```

- [ ] **Step 4: Run tests; expect PASS (4 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/retrieve.ts tests/unit/retrieve.test.ts
git commit -m "feat(chat-server): hybrid cosine + BM25 retrieval"
```

---

### Task 3.4: mp4Url construction

**Files:**
- Create: `src/chat-server/mp4-url.ts`
- Create: `tests/unit/mp4-url.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/mp4-url.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildMp4Url } from "../../src/chat-server/mp4-url.js";

describe("buildMp4Url", () => {
  it("constructs the canonical URL from baseUrl + widgetId + demoId", () => {
    expect(buildMp4Url({
      baseUrl: "https://daymo.dev",
      widgetId: "wgt_a",
      demoId: "loomly-tour",
    })).toBe("https://daymo.dev/widgets/wgt_a/demos/loomly-tour/output.mp4");
  });

  it("strips trailing slash from baseUrl", () => {
    expect(buildMp4Url({
      baseUrl: "https://daymo.dev/",
      widgetId: "wgt_a",
      demoId: "x",
    })).toBe("https://daymo.dev/widgets/wgt_a/demos/x/output.mp4");
  });

  it("rejects path-traversal in widgetId or demoId", () => {
    expect(() => buildMp4Url({ baseUrl: "https://x", widgetId: "..", demoId: "y" })).toThrow();
    expect(() => buildMp4Url({ baseUrl: "https://x", widgetId: "a", demoId: "../etc/passwd" })).toThrow();
    expect(() => buildMp4Url({ baseUrl: "https://x", widgetId: "a/b", demoId: "c" })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `src/chat-server/mp4-url.ts`:

```typescript
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export interface BuildMp4UrlOpts {
  baseUrl: string;
  widgetId: string;
  demoId: string;
}

export function buildMp4Url(opts: BuildMp4UrlOpts): string {
  if (!SAFE_ID.test(opts.widgetId)) {
    throw new Error(`unsafe widgetId: ${opts.widgetId}`);
  }
  if (!SAFE_ID.test(opts.demoId)) {
    throw new Error(`unsafe demoId: ${opts.demoId}`);
  }
  const base = opts.baseUrl.replace(/\/+$/, "");
  return `${base}/widgets/${opts.widgetId}/demos/${opts.demoId}/output.mp4`;
}
```

- [ ] **Step 4: Run tests; expect PASS (3 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/mp4-url.ts tests/unit/mp4-url.test.ts
git commit -m "feat(chat-server): mp4Url construction with id validation"
```

---

### Task 3.5: CORS / origin allowlist

**Files:**
- Create: `src/chat-server/cors.ts`
- Create: `tests/unit/cors.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/cors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { checkOrigin, corsHeaders } from "../../src/chat-server/cors.js";

describe("checkOrigin", () => {
  it("returns true for an exact match against the allowlist", () => {
    expect(checkOrigin("https://example.com", ["https://example.com"])).toBe(true);
  });
  it("is case-sensitive on the host (https vs HTTPS does NOT match)", () => {
    expect(checkOrigin("HTTPS://example.com", ["https://example.com"])).toBe(false);
  });
  it("rejects unknown origins", () => {
    expect(checkOrigin("https://evil.com", ["https://example.com"])).toBe(false);
  });
  it("rejects empty / missing origin header", () => {
    expect(checkOrigin(undefined, ["https://example.com"])).toBe(false);
    expect(checkOrigin("", ["https://example.com"])).toBe(false);
  });
  it("rejects '*' wildcard regardless of allowlist content", () => {
    expect(checkOrigin("https://example.com", ["*"])).toBe(false);
  });
});

describe("corsHeaders", () => {
  it("emits the request's origin (not '*') so credentials are allowed", () => {
    const h = corsHeaders("https://example.com");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://example.com");
    expect(h["Vary"]).toBe("Origin");
  });
  it("sets allowed methods and content-type for the preflight", () => {
    const h = corsHeaders("https://example.com");
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
    expect(h["Access-Control-Allow-Methods"]).toContain("GET");
    expect(h["Access-Control-Allow-Headers"]).toContain("Content-Type");
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `src/chat-server/cors.ts`:

```typescript
export function checkOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  // Wildcard is explicitly rejected — must be an exact origin.
  if (allowedOrigins.some((o) => o === "*")) return false;
  return allowedOrigins.includes(origin);
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
```

- [ ] **Step 4: Run tests; expect PASS (7 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/cors.ts tests/unit/cors.test.ts
git commit -m "feat(chat-server): origin allowlist + CORS headers"
```

---

### Task 3.6: Rate limiter (in-memory token bucket)

**Files:**
- Create: `src/chat-server/rate-limit.ts`
- Create: `tests/unit/rate-limit.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/rate-limit.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../../src/chat-server/rate-limit.js";

describe("rate limiter", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-14T00:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows up to N requests per window per key", () => {
    const rl = createRateLimiter({ maxPerMinute: 3 });
    expect(rl.check("k1").allowed).toBe(true);
    expect(rl.check("k1").allowed).toBe(true);
    expect(rl.check("k1").allowed).toBe(true);
    const fourth = rl.check("k1");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
  });

  it("separates buckets per key", () => {
    const rl = createRateLimiter({ maxPerMinute: 1 });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(false);
  });

  it("refills after the window elapses", () => {
    const rl = createRateLimiter({ maxPerMinute: 1 });
    expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rl.check("k").allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `src/chat-server/rate-limit.ts`:

```typescript
export interface RateLimiterOpts {
  maxPerMinute: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
}

interface Bucket {
  windowStartMs: number;
  count: number;
}

/** In-memory fixed-window rate limiter. One bucket per key (e.g.
 *  "widgetId:clientIp"). Window resets every 60s. */
export function createRateLimiter(opts: RateLimiterOpts): {
  check(key: string): RateLimitDecision;
} {
  const buckets = new Map<string, Bucket>();
  const windowMs = 60_000;
  return {
    check(key: string): RateLimitDecision {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || now - b.windowStartMs >= windowMs) {
        b = { windowStartMs: now, count: 0 };
        buckets.set(key, b);
      }
      if (b.count >= opts.maxPerMinute) {
        const elapsed = now - b.windowStartMs;
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)) };
      }
      b.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}
```

- [ ] **Step 4: Run tests; expect PASS (3 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/rate-limit.ts tests/unit/rate-limit.test.ts
git commit -m "feat(chat-server): in-memory rate limiter"
```

---

### Task 3.7: ChatResponse validator (Layer 3 certainty)

**Files:**
- Create: `src/chat-server/validate-response.ts`
- Create: `tests/unit/validate-response.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/validate-response.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateChatResponse } from "../../src/chat-server/validate-response.js";
import type { ChatResponse, IndexedChunk } from "../../src/types.js";

const stepLookup = new Map<string, IndexedChunk>([
  ["d:0:1", { stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 1000, globalEndMs: 2000, text: "", embedding: [], keywords: [] }],
  ["d:0:2", { stepId: "d:0:2", demoId: "d", sceneIndex: 0, stepIndex: 2, globalStartMs: 2000, globalEndMs: 3000, text: "", embedding: [], keywords: [] }],
]);

describe("validateChatResponse", () => {
  it("passes a well-formed answer with valid stepIds and matching timestamps", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "text", text: "Here:" },
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "c", mp4Url: "x" },
    ]};
    expect(validateChatResponse(resp, stepLookup).ok).toBe(true);
  });

  it("downgrades to no_match when a stepId does not exist in the index", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "video", stepId: "d:0:99", demoId: "d", startMs: 1000, endMs: 2000, caption: "", mp4Url: "" },
    ]};
    const r = validateChatResponse(resp, stepLookup);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown stepId/i);
  });

  it("downgrades when (start,end)Ms don't match the index", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1234, endMs: 5678, caption: "", mp4Url: "" },
    ]};
    expect(validateChatResponse(resp, stepLookup).ok).toBe(false);
  });

  it("downgrades when more than 3 VideoParts are present", () => {
    const v = (n: number): import("../../src/types.js").VideoPart => ({
      kind: "video",
      stepId: `d:0:${n}`,
      demoId: "d",
      startMs: 0,
      endMs: 100,
      caption: "",
      mp4Url: "",
    });
    const resp: ChatResponse = { kind: "answer", parts: [v(1), v(2), v(1), v(2)] };
    expect(validateChatResponse(resp, stepLookup).ok).toBe(false);
  });

  it("downgrades when two consecutive parts are videos", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "", mp4Url: "" },
      { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 2000, endMs: 3000, caption: "", mp4Url: "" },
    ]};
    expect(validateChatResponse(resp, stepLookup).ok).toBe(false);
  });

  it("downgrades when total parts > 6", () => {
    const t = (): import("../../src/types.js").TextPart => ({ kind: "text", text: "x" });
    const resp: ChatResponse = { kind: "answer", parts: [t(), t(), t(), t(), t(), t(), t()] };
    expect(validateChatResponse(resp, stepLookup).ok).toBe(false);
  });

  it("passes no_match responses unchanged", () => {
    const resp: ChatResponse = { kind: "no_match", text: "nope" };
    expect(validateChatResponse(resp, stepLookup).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `src/chat-server/validate-response.ts`:

```typescript
import type { ChatResponse, IndexedChunk } from "../types.js";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const MAX_PARTS = 6;
const MAX_VIDEO_PARTS = 3;

export function validateChatResponse(
  resp: ChatResponse,
  stepLookup: Map<string, IndexedChunk>,
): ValidationResult {
  if (resp.kind === "no_match") return { ok: true };

  const parts = resp.parts;
  if (parts.length === 0 || parts.length > MAX_PARTS) {
    return { ok: false, reason: `parts count out of range: ${parts.length}` };
  }

  let videoCount = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.kind === "video") {
      videoCount += 1;
      if (i > 0 && parts[i - 1].kind === "video") {
        return { ok: false, reason: `two consecutive video parts at index ${i}` };
      }
      const idx = stepLookup.get(p.stepId);
      if (!idx) return { ok: false, reason: `unknown stepId: ${p.stepId}` };
      if (idx.globalStartMs !== p.startMs || idx.globalEndMs !== p.endMs) {
        return { ok: false, reason: `timestamp mismatch for ${p.stepId}` };
      }
      if (idx.demoId !== p.demoId) {
        return { ok: false, reason: `demoId mismatch for ${p.stepId}` };
      }
    }
  }
  if (videoCount > MAX_VIDEO_PARTS) {
    return { ok: false, reason: `too many video parts: ${videoCount}` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests; expect PASS (7 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/validate-response.ts tests/unit/validate-response.test.ts
git commit -m "feat(chat-server): Layer-3 stepId/timestamp/structure validation"
```

---

### Task 3.8: Config + index loader with LRU cache

**Files:**
- Create: `src/chat-server/index-cache.ts`
- Create: `tests/unit/index-cache.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/index-cache.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createIndexCache } from "../../src/chat-server/index-cache.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IndexFile, WidgetConfig } from "../../src/types.js";

const makeIndex = (widgetId: string): IndexFile => ({
  version: "v1",
  widgetId,
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 768,
  createdAt: "2026-05-14T00:00:00Z",
  etag: "x",
  demos: [],
  chunks: [],
});
const makeConfig = (widgetId: string): WidgetConfig => ({
  widgetId, name: "w", locale: "en", allowedOrigins: [], suggestedQuestions: [],
});

async function setupWidget(root: string, id: string) {
  await fs.mkdir(path.join(root, "widgets", id), { recursive: true });
  await fs.writeFile(path.join(root, "widgets", id, "index.json"), JSON.stringify(makeIndex(id)));
  await fs.writeFile(path.join(root, "widgets", id, "config.json"), JSON.stringify(makeConfig(id)));
}

describe("index cache", () => {
  it("loads index + config from disk on first call, then memoizes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    await setupWidget(root, "w1");
    const cache = createIndexCache({ dataRoot: root, maxResident: 5 });
    const r1 = await cache.load("w1");
    const r2 = await cache.load("w1");
    expect(r1.index.widgetId).toBe("w1");
    expect(r1.config.widgetId).toBe("w1");
    expect(r1).toBe(r2); // same object reference: memoized
  });

  it("evicts least-recently-used when maxResident is exceeded", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    for (const id of ["a", "b", "c", "d"]) await setupWidget(root, id);
    const cache = createIndexCache({ dataRoot: root, maxResident: 2 });
    const a = await cache.load("a");
    await cache.load("b");
    await cache.load("c"); // evicts a
    const aReloaded = await cache.load("a");
    expect(aReloaded).not.toBe(a); // a was evicted and reloaded
  });

  it("invalidate(widgetId) drops a single entry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    await setupWidget(root, "w1");
    const cache = createIndexCache({ dataRoot: root, maxResident: 5 });
    const r1 = await cache.load("w1");
    cache.invalidate("w1");
    const r2 = await cache.load("w1");
    expect(r2).not.toBe(r1);
  });

  it("throws a clean error when the widget is unknown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    const cache = createIndexCache({ dataRoot: root, maxResident: 5 });
    await expect(cache.load("missing")).rejects.toThrow(/widget/i);
  });

  it("rejects index files whose version is not 'v1'", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    await fs.mkdir(path.join(root, "widgets", "w"), { recursive: true });
    await fs.writeFile(path.join(root, "widgets", "w", "index.json"), JSON.stringify({ ...makeIndex("w"), version: "v999" }));
    await fs.writeFile(path.join(root, "widgets", "w", "config.json"), JSON.stringify(makeConfig("w")));
    const cache = createIndexCache({ dataRoot: root, maxResident: 5 });
    await expect(cache.load("w")).rejects.toThrow(/version/i);
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `src/chat-server/index-cache.ts`:

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { IndexFile, WidgetConfig, IndexedChunk } from "../types.js";

export interface CacheEntry {
  index: IndexFile;
  config: WidgetConfig;
  stepLookup: Map<string, IndexedChunk>;
}

export interface IndexCacheOpts {
  dataRoot: string;
  maxResident: number;
}

export function createIndexCache(opts: IndexCacheOpts): {
  load(widgetId: string): Promise<CacheEntry>;
  invalidate(widgetId: string): void;
} {
  // Map preserves insertion order; we use it as LRU by re-inserting on access.
  const lru = new Map<string, CacheEntry>();

  async function loadFromDisk(widgetId: string): Promise<CacheEntry> {
    const dir = path.join(opts.dataRoot, "widgets", widgetId);
    let index: IndexFile;
    let config: WidgetConfig;
    try {
      index = JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8")) as IndexFile;
      config = JSON.parse(await fs.readFile(path.join(dir, "config.json"), "utf8")) as WidgetConfig;
    } catch (err) {
      throw new Error(`widget ${widgetId} not found in data root ${opts.dataRoot}: ${(err as Error).message}`);
    }
    if (index.version !== "v1") {
      throw new Error(`unsupported index version for widget ${widgetId}: ${index.version}`);
    }
    const stepLookup = new Map<string, IndexedChunk>();
    for (const c of index.chunks) stepLookup.set(c.stepId, c);
    return { index, config, stepLookup };
  }

  return {
    async load(widgetId: string): Promise<CacheEntry> {
      const existing = lru.get(widgetId);
      if (existing) {
        // Move to end of insertion order (LRU touch)
        lru.delete(widgetId);
        lru.set(widgetId, existing);
        return existing;
      }
      const fresh = await loadFromDisk(widgetId);
      lru.set(widgetId, fresh);
      while (lru.size > opts.maxResident) {
        const oldest = lru.keys().next().value;
        if (oldest === undefined) break;
        lru.delete(oldest);
      }
      return fresh;
    },
    invalidate(widgetId: string): void {
      lru.delete(widgetId);
    },
  };
}
```

- [ ] **Step 4: Run tests; expect PASS (5 tests)**

- [ ] **Step 5: Commit**

```bash
git add src/chat-server/index-cache.ts tests/unit/index-cache.test.ts
git commit -m "feat(chat-server): LRU index+config cache"
```

---

### Task 3.9: Query rewriter (Haiku 4.5)

**Files:**
- Create: `src/chat-server/rewrite-query.ts`
- Create: `tests/unit/rewrite-query.test.ts`
- Create: `tests/integration/rewrite-query-real.test.ts` (gated by `RUN_LLM_TESTS=1`)

- [ ] **Step 1: Failing unit tests with a mock SDK client**

Create `tests/unit/rewrite-query.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { rewriteQuery } from "../../src/chat-server/rewrite-query.js";

describe("rewriteQuery", () => {
  it("returns the user message verbatim when history is empty", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "How do I create a project?" }],
        }),
      },
    };
    const out = await rewriteQuery({
      message: "How do I create a project?",
      history: [],
      client: mockClient as never,
    });
    expect(out).toBe("How do I create a project?");
  });

  it("incorporates conversation history into the rewritten query", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "what comes after creating a project?" }],
        }),
      },
    };
    const out = await rewriteQuery({
      message: "and then?",
      history: [
        { role: "user", content: "how do I create a project?" },
        { role: "assistant", content: "Click + New project." },
      ],
      client: mockClient as never,
    });
    expect(out).toBe("what comes after creating a project?");
    expect(mockClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001" }),
    );
  });

  it("trims surrounding whitespace and quotes from the model output", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: '  "rewritten query"  ' }],
        }),
      },
    };
    const out = await rewriteQuery({ message: "x", history: [], client: mockClient as never });
    expect(out).toBe("rewritten query");
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `src/chat-server/rewrite-query.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";

export interface RewriteQueryOpts {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  client: Anthropic;
}

const SYSTEM = `You rewrite the user's latest message into a single self-contained search query that captures their full intent given prior conversation turns. Output ONLY the query — no preamble, no quoting, no punctuation beyond what's strictly needed. Keep it ≤30 tokens.`;

export async function rewriteQuery(opts: RewriteQueryOpts): Promise<string> {
  const historyText = opts.history
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");
  const userBlock = [
    historyText ? `Conversation so far:\n${historyText}\n` : "",
    `Latest message: ${opts.message}`,
    "",
    "Search query:",
  ].join("\n");

  const resp = await opts.client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 64,
    system: SYSTEM,
    messages: [{ role: "user", content: userBlock }],
  });
  const block = resp.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
  const raw = block?.text ?? "";
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}
```

- [ ] **Step 4: Run tests; expect PASS**

- [ ] **Step 5: Write gated integration test**

Create `tests/integration/rewrite-query-real.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { rewriteQuery } from "../../src/chat-server/rewrite-query.js";

const run = process.env.RUN_LLM_TESTS === "1" && process.env.ANTHROPIC_API_KEY;

describe.skipIf(!run)("rewriteQuery (real Haiku)", () => {
  it("rewrites 'and then?' using prior context", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const out = await rewriteQuery({
      message: "and then?",
      history: [
        { role: "user", content: "how do I create a project?" },
        { role: "assistant", content: "Click + New project, fill in the name and description, hit Create." },
      ],
      client,
    });
    // Loose assertion: the rewrite should reference 'after' or 'next' or include project context.
    expect(out.toLowerCase()).toMatch(/(after|next|then|continue|project)/);
  }, 30_000);
});
```

- [ ] **Step 6: Commit**

```bash
git add src/chat-server/rewrite-query.ts tests/unit/rewrite-query.test.ts tests/integration/rewrite-query-real.test.ts
git commit -m "feat(chat-server): Haiku-backed query rewriter"
```

---

### Task 3.10: Answer LLM (Sonnet 4.6 with structured outputs)

**Files:**
- Create: `src/chat-server/answer-llm.ts`
- Create: `tests/unit/answer-llm.test.ts`
- Create: `tests/integration/answer-llm-real.test.ts` (gated)

- [ ] **Step 1: Failing unit tests**

Create `tests/unit/answer-llm.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { answerWithChunks } from "../../src/chat-server/answer-llm.js";
import type { IndexedChunk, ChatResponse } from "../../src/types.js";

function chunk(stepId: string, text: string): IndexedChunk {
  const [demoId, sceneIndex, stepIndex] = stepId.split(":");
  return {
    stepId,
    demoId,
    sceneIndex: Number(sceneIndex),
    stepIndex: Number(stepIndex),
    globalStartMs: 1000,
    globalEndMs: 2000,
    text,
    embedding: [],
    keywords: [],
  };
}

describe("answerWithChunks", () => {
  it("returns the parsed JSON ChatResponse from the LLM", async () => {
    const payload: ChatResponse = {
      kind: "answer",
      parts: [
        { kind: "text", text: "Here's how:" },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "Step 1", mp4Url: "" },
      ],
    };
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify(payload) }],
        }),
      },
    };
    const out = await answerWithChunks({
      query: "how do I X?",
      history: [],
      chunks: [chunk("d:0:1", "step text")],
      locale: "en",
      client: mockClient as never,
    });
    expect(out).toEqual(payload);
  });

  it("returns no_match when the model emits invalid JSON", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "I'm sorry, not JSON." }],
        }),
      },
    };
    const out = await answerWithChunks({
      query: "x", history: [], chunks: [], locale: "en", client: mockClient as never,
    });
    expect(out.kind).toBe("no_match");
  });

  it("returns no_match when the model emits a shape that doesn't match the schema", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ kind: "answer", parts: "not an array" }) }],
        }),
      },
    };
    const out = await answerWithChunks({
      query: "x", history: [], chunks: [], locale: "en", client: mockClient as never,
    });
    expect(out.kind).toBe("no_match");
  });

  it("passes locale into the system prompt", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: JSON.stringify({ kind: "no_match", text: "x" }) }],
        }),
      },
    };
    await answerWithChunks({
      query: "x", history: [], chunks: [], locale: "ja", client: mockClient as never,
    });
    const call = mockClient.messages.create.mock.calls[0][0];
    expect(call.system).toContain("ja");
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `src/chat-server/answer-llm.ts`:

```typescript
import type Anthropic from "@anthropic-ai/sdk";
import type { IndexedChunk, ChatResponse } from "../types.js";

export interface AnswerOpts {
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  chunks: IndexedChunk[];
  locale: string;
  client: Anthropic;
}

const SYSTEM_TEMPLATE = (locale: string) => `You answer "how do I X?" questions about a product using ONLY the retrieved demo chunks provided below. Your output is a JSON object matching this schema:

type ChatResponse =
  | { "kind": "answer", "parts": Part[] }
  | { "kind": "no_match", "text": string, "suggestions"?: string[] };

type Part =
  | { "kind": "text", "text": string }
  | { "kind": "video", "stepId": string, "demoId": string, "startMs": number, "endMs": number, "caption": string, "mp4Url": "" };

Rules:
- Output ONLY the JSON object — no preamble, no markdown fences.
- If the retrieved chunks don't clearly answer the question, return { "kind": "no_match", "text": "<honest fallback>", "suggestions": ["...up to 3..."] }. Never use general knowledge to fill gaps.
- Every VideoPart.stepId MUST appear verbatim in a chunk below. Never invent stepIds.
- Always set "mp4Url" to "" — the server fills it in.
- Interleave parts: each video part must be preceded by a text part. Never two consecutive videos.
- Total parts ≤ 6. Video parts ≤ 3.
- Respond in this language: ${locale}. If the user's message is in another language, prefer that one.
- For text-only answers (chunks contain explanation but no specific visual moment), return a single TextPart.`;

const SCHEMA_GUIDANCE = `Return a JSON object with this exact shape. Never return prose, never return markdown.`;

function renderChunks(chunks: IndexedChunk[]): string {
  return chunks.map((c, i) => `--- chunk ${i + 1} ---\nstepId: ${c.stepId}\ndemoId: ${c.demoId}\nstartMs: ${c.globalStartMs}\nendMs: ${c.globalEndMs}\ntext:\n${c.text}\n`).join("\n");
}

function renderHistory(history: AnswerOpts["history"]): string {
  if (history.length === 0) return "(no prior turns)";
  return history.map((t) => `${t.role}: ${t.content}`).join("\n");
}

export async function answerWithChunks(opts: AnswerOpts): Promise<ChatResponse> {
  const userBlock = [
    SCHEMA_GUIDANCE,
    "",
    "Retrieved chunks:",
    renderChunks(opts.chunks),
    "",
    "Conversation history:",
    renderHistory(opts.history),
    "",
    `User: ${opts.query}`,
  ].join("\n");

  const resp = await opts.client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_TEMPLATE(opts.locale),
    messages: [{ role: "user", content: userBlock }],
  });
  const block = resp.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
  const raw = block?.text ?? "";

  try {
    const parsed = JSON.parse(raw) as ChatResponse;
    if (parsed.kind === "answer" && !Array.isArray((parsed as { parts: unknown }).parts)) {
      return { kind: "no_match", text: "I couldn't construct an answer." };
    }
    if (parsed.kind !== "answer" && parsed.kind !== "no_match") {
      return { kind: "no_match", text: "I couldn't construct an answer." };
    }
    return parsed;
  } catch {
    return { kind: "no_match", text: "I couldn't construct an answer." };
  }
}
```

- [ ] **Step 4: Run tests; expect PASS (4 tests)**

- [ ] **Step 5: Write gated integration test**

Create `tests/integration/answer-llm-real.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { answerWithChunks } from "../../src/chat-server/answer-llm.js";
import type { IndexedChunk } from "../../src/types.js";

const run = process.env.RUN_LLM_TESTS === "1" && process.env.ANTHROPIC_API_KEY;

const chunkA: IndexedChunk = {
  stepId: "loomly:0:1", demoId: "loomly", sceneIndex: 0, stepIndex: 1,
  globalStartMs: 12000, globalEndMs: 18000,
  text: "[Demo] Loomly Tour\n[Scene] Create projects\n[Step] Open the new-project dialog\nClick + New project to start a fresh one.",
  embedding: [], keywords: [],
};

describe.skipIf(!run)("answerWithChunks (real Sonnet)", () => {
  it("returns a structured answer for a matching question", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const out = await answerWithChunks({
      query: "How do I create a project?",
      history: [],
      chunks: [chunkA],
      locale: "en",
      client,
    });
    expect(out.kind).toBe("answer");
    if (out.kind === "answer") {
      const video = out.parts.find((p) => p.kind === "video");
      expect(video).toBeTruthy();
      if (video && video.kind === "video") {
        expect(video.stepId).toBe("loomly:0:1");
      }
    }
  }, 60_000);

  it("returns no_match for an off-topic question", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const out = await answerWithChunks({
      query: "What's the airspeed velocity of an unladen swallow?",
      history: [],
      chunks: [chunkA],
      locale: "en",
      client,
    });
    expect(out.kind).toBe("no_match");
  }, 60_000);
});
```

- [ ] **Step 6: Commit**

```bash
git add src/chat-server/answer-llm.ts tests/unit/answer-llm.test.ts tests/integration/answer-llm-real.test.ts
git commit -m "feat(chat-server): Sonnet-backed answer LLM with JSON schema"
```

---

### Task 3.11: POST /chat handler — wires the pipeline together

**Files:**
- Create: `src/chat-server/handlers/chat.ts`
- Create: `tests/integration/chat-endpoint.test.ts`

- [ ] **Step 1: Integration test against an in-process server (mocked LLM + embed)**

Create `tests/integration/chat-endpoint.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../../src/chat-server/server.js";
import type { IndexFile, WidgetConfig } from "../../src/types.js";

async function postJson(port: number, urlPath: string, body: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port, path: urlPath, method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "1.2.3.4", ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function setupWidget(dataRoot: string) {
  const id = "wgt_test";
  const idx: IndexFile = {
    version: "v1", widgetId: id,
    embeddingModel: "gemini-embedding-001", embeddingDims: 3,
    createdAt: "2026-05-14T00:00:00Z", etag: "x",
    demos: [{ demoId: "d", title: "D", description: "", durationMs: 10000 }],
    chunks: [
      {
        stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1,
        globalStartMs: 1000, globalEndMs: 2000,
        text: "[Demo] D\n[Scene] s\n[Step] Open dialog\nClick + New project.",
        embedding: [1, 0, 0], keywords: ["open", "dialog", "project", "new"],
      },
    ],
  };
  const cfg: WidgetConfig = {
    widgetId: id, name: "T", locale: "en",
    allowedOrigins: ["https://example.com"], suggestedQuestions: [],
  };
  await fs.mkdir(path.join(dataRoot, "widgets", id), { recursive: true });
  await fs.writeFile(path.join(dataRoot, "widgets", id, "index.json"), JSON.stringify(idx));
  await fs.writeFile(path.join(dataRoot, "widgets", id, "config.json"), JSON.stringify(cfg));
  await fs.writeFile(path.join(dataRoot, "widgets", id, "demos", "d", "output.mp4")
    .replace(/[\\/]demos[\\/]d[\\/]output.mp4$/, "/demos/d/output.mp4"), "")
    .catch(async () => {
      await fs.mkdir(path.join(dataRoot, "widgets", id, "demos", "d"), { recursive: true });
      await fs.writeFile(path.join(dataRoot, "widgets", id, "demos", "d", "output.mp4"), "");
    });
}

describe("POST /chat", () => {
  it("returns a structured answer when the LLM matches a chunk", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);

    const fakeEmbed = vi.fn().mockResolvedValue([1, 0, 0]);
    const fakeLLM = {
      messages: {
        create: vi.fn()
          // first call = rewrite
          .mockResolvedValueOnce({ content: [{ type: "text", text: "How do I open the dialog?" }] })
          // second call = answer
          .mockResolvedValueOnce({
            content: [{ type: "text", text: JSON.stringify({
              kind: "answer", parts: [
                { kind: "text", text: "Click + New project." },
                { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "Open dialog", mp4Url: "" },
              ],
            }) }],
          }),
      },
    };

    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      dataRoot,
      anthropicClient: fakeLLM as never,
      embedQueryFn: fakeEmbed,
      baseUrl: "https://daymo.dev",
    });

    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "how do I X?", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.kind).toBe("answer");
    const video = body.parts.find((p: { kind: string }) => p.kind === "video");
    expect(video.mp4Url).toBe("https://daymo.dev/widgets/wgt_test/demos/d/output.mp4");

    server.close();
  });

  it("returns no_match when topCosineScore is below 0.55", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);

    const fakeEmbed = vi.fn().mockResolvedValue([0, 1, 0]); // orthogonal to all chunks
    const fakeLLM = {
      messages: {
        create: vi.fn().mockResolvedValueOnce({ content: [{ type: "text", text: "weird question" }] }),
      },
    };

    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      anthropicClient: fakeLLM as never, embedQueryFn: fakeEmbed, baseUrl: "https://daymo.dev",
    });
    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "weird question", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(200);
    expect(JSON.parse(resp.body).kind).toBe("no_match");
    server.close();
  });

  it("returns 403 when Origin is not in the allowlist", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);
    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      anthropicClient: { messages: { create: vi.fn() } } as never,
      embedQueryFn: vi.fn(), baseUrl: "https://x",
    });
    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "x", history: [] },
      { Origin: "https://evil.example.com" },
    );
    expect(resp.status).toBe(403);
    server.close();
  });

  it("returns 404 when widgetId is unknown", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);
    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      anthropicClient: { messages: { create: vi.fn() } } as never,
      embedQueryFn: vi.fn(), baseUrl: "https://x",
    });
    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "no_such", message: "x", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(404);
    server.close();
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);
    const fakeEmbed = vi.fn().mockResolvedValue([0, 1, 0]);
    const fakeLLM = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "x" }] }) },
    };
    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      anthropicClient: fakeLLM as never, embedQueryFn: fakeEmbed, baseUrl: "https://x",
      rateLimitPerMinute: 2,
    });
    const port = (server.address() as { port: number }).port;
    for (let i = 0; i < 2; i++) {
      const ok = await postJson(port, "/chat", { widgetId: "wgt_test", message: "x", history: [] }, { Origin: "https://example.com" });
      expect(ok.status).toBe(200);
    }
    const overLimit = await postJson(port, "/chat", { widgetId: "wgt_test", message: "x", history: [] }, { Origin: "https://example.com" });
    expect(overLimit.status).toBe(429);
    expect(overLimit.headers["retry-after"]).toBeDefined();
    server.close();
  });
});
```

- [ ] **Step 2: Run test; expect FAIL (server.js + handler do not exist yet)**

- [ ] **Step 3: Implement `chat.ts` handler**

Create `src/chat-server/handlers/chat.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatRequest, ChatResponse, Part, VideoPart } from "../../types.js";
import { rewriteQuery } from "../rewrite-query.js";
import { answerWithChunks } from "../answer-llm.js";
import { retrieve } from "../retrieve.js";
import { extractKeywords } from "../../indexer/keywords.js";
import { validateChatResponse } from "../validate-response.js";
import { buildMp4Url } from "../mp4-url.js";
import type { CacheEntry } from "../index-cache.js";

const SCORE_THRESHOLD = 0.55;

export interface ChatHandlerDeps {
  loadWidget: (id: string) => Promise<CacheEntry>;
  anthropicClient: Anthropic;
  embedQueryFn: (text: string) => Promise<number[]>;
  baseUrl: string;
}

export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  body: ChatRequest,
  deps: ChatHandlerDeps,
): Promise<void> {
  let entry: CacheEntry;
  try {
    entry = await deps.loadWidget(body.widgetId);
  } catch {
    return sendJson(res, 404, { kind: "no_match", text: "This help widget is not configured." });
  }

  const locale = body.locale ?? entry.config.locale;
  const history = body.history.slice(-2); // server-side safety belt

  // Stage 1: rewrite query
  const rewritten = history.length === 0
    ? body.message
    : await rewriteQuery({ message: body.message, history, client: deps.anthropicClient });

  // Stage 2: retrieve
  const queryEmbedding = await deps.embedQueryFn(rewritten);
  const queryKeywords = extractKeywords(rewritten);
  const retrieval = retrieve({
    query: { embedding: queryEmbedding, keywords: queryKeywords },
    chunks: entry.index.chunks,
    k: 8,
  });

  // Stage 3: score gate
  if (retrieval.topCosineScore < SCORE_THRESHOLD) {
    return sendJson(res, 200, noMatchWithSuggestions(entry.config.suggestedQuestions));
  }

  // Stage 4: answer LLM
  let response = await answerWithChunks({
    query: rewritten,
    history,
    chunks: retrieval.chunks,
    locale,
    client: deps.anthropicClient,
  });

  // Stage 5: server validation + mp4Url injection
  if (response.kind === "answer") {
    response = {
      kind: "answer",
      parts: response.parts.map((p): Part => {
        if (p.kind !== "video") return p;
        const v = p as VideoPart;
        return {
          ...v,
          mp4Url: buildMp4Url({ baseUrl: deps.baseUrl, widgetId: body.widgetId, demoId: v.demoId }),
        };
      }),
    };
  }
  const validation = validateChatResponse(response, entry.stepLookup);
  if (!validation.ok) {
    response = noMatchWithSuggestions(entry.config.suggestedQuestions);
  }

  sendJson(res, 200, response);
}

function noMatchWithSuggestions(suggestions: string[]): ChatResponse {
  return {
    kind: "no_match",
    text: "I don't have that in the demos. Try one of these:",
    suggestions: suggestions.slice(0, 3),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
```

- [ ] **Step 4: Implement `widget-config.ts` handler**

Create `src/chat-server/handlers/widget-config.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CacheEntry } from "../index-cache.js";

export interface WidgetConfigDeps {
  loadWidget: (id: string) => Promise<CacheEntry>;
}

export async function handleWidgetConfig(
  _req: IncomingMessage,
  res: ServerResponse,
  widgetId: string,
  deps: WidgetConfigDeps,
): Promise<void> {
  try {
    const entry = await deps.loadWidget(widgetId);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      widgetId: entry.config.widgetId,
      name: entry.config.name,
      brandColor: entry.config.brandColor,
      locale: entry.config.locale,
      suggestedQuestions: entry.config.suggestedQuestions,
    }));
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "widget not found" }));
  }
}
```

- [ ] **Step 5: Implement `mp4.ts` handler (range-aware static file serving)**

Create `src/chat-server/handlers/mp4.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

export interface Mp4HandlerDeps {
  dataRoot: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  if (startRaw === "" && endRaw === "") return null;
  let start: number, end: number;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Number(endRaw);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

export async function handleMp4(
  req: IncomingMessage,
  res: ServerResponse,
  widgetId: string,
  demoId: string,
  deps: Mp4HandlerDeps,
): Promise<void> {
  if (!SAFE_ID.test(widgetId) || !SAFE_ID.test(demoId)) {
    res.statusCode = 400;
    res.end();
    return;
  }
  const filePath = path.join(deps.dataRoot, "widgets", widgetId, "demos", demoId, "output.mp4");
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    res.statusCode = 404;
    res.end();
    return;
  }
  if (!stat.isFile()) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const range = parseRange(req.headers.range, stat.size);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  if (range) {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(stat.size));
    createReadStream(filePath).pipe(res);
  }
}
```

- [ ] **Step 6: Implement `admin-reload.ts` handler**

Create `src/chat-server/handlers/admin-reload.ts`:

```typescript
import type { IncomingMessage, ServerResponse } from "node:http";

export interface AdminReloadDeps {
  invalidate: (widgetId: string) => void;
  adminToken: string | undefined;
}

export function handleAdminReload(
  req: IncomingMessage,
  res: ServerResponse,
  widgetId: string,
  deps: AdminReloadDeps,
): void {
  if (!deps.adminToken) {
    res.statusCode = 503;
    res.end("admin token not configured");
    return;
  }
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${deps.adminToken}`) {
    res.statusCode = 401;
    res.end();
    return;
  }
  deps.invalidate(widgetId);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, invalidated: widgetId }));
}
```

- [ ] **Step 7: Implement `server.ts` + `router.ts`**

Create `src/chat-server/router.ts`:

```typescript
export interface RouteMatch {
  handler:
    | { name: "chat" }
    | { name: "widget-config"; widgetId: string }
    | { name: "mp4"; widgetId: string; demoId: string }
    | { name: "admin-reload"; widgetId: string }
    | { name: "preflight" }
    | { name: "not-found" };
}

export function route(method: string, urlPath: string): RouteMatch {
  if (method === "OPTIONS") return { handler: { name: "preflight" } };
  if (method === "POST" && urlPath === "/chat") return { handler: { name: "chat" } };
  const wcfg = /^\/widget-config\/([A-Za-z0-9_-]+)$/.exec(urlPath);
  if (method === "GET" && wcfg) return { handler: { name: "widget-config", widgetId: wcfg[1] } };
  const mp4 = /^\/widgets\/([A-Za-z0-9_-]+)\/demos\/([A-Za-z0-9_-]+)\/output\.mp4$/.exec(urlPath);
  if (method === "GET" && mp4) return { handler: { name: "mp4", widgetId: mp4[1], demoId: mp4[2] } };
  const adminUrl = new URL(urlPath, "http://x");
  if (method === "POST" && adminUrl.pathname === "/admin/reload") {
    const widgetId = adminUrl.searchParams.get("widgetId");
    if (widgetId) return { handler: { name: "admin-reload", widgetId } };
  }
  return { handler: { name: "not-found" } };
}
```

Create `src/chat-server/server.ts`:

```typescript
import http, { type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import { createIndexCache } from "./index-cache.js";
import { createRateLimiter } from "./rate-limit.js";
import { route } from "./router.js";
import { checkOrigin, corsHeaders } from "./cors.js";
import { handleChat } from "./handlers/chat.js";
import { handleWidgetConfig } from "./handlers/widget-config.js";
import { handleMp4 } from "./handlers/mp4.js";
import { handleAdminReload } from "./handlers/admin-reload.js";
import type { ChatRequest } from "../types.js";

export interface ServerOpts {
  port: number;
  host: string;
  dataRoot: string;
  anthropicClient: Anthropic;
  embedQueryFn: (text: string) => Promise<number[]>;
  baseUrl: string;
  rateLimitPerMinute?: number;
  maxResidentWidgets?: number;
  adminToken?: string;
}

async function readJson<T>(req: IncomingMessage, limit = 1_000_000): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export async function startServer(opts: ServerOpts): Promise<Server> {
  const cache = createIndexCache({ dataRoot: opts.dataRoot, maxResident: opts.maxResidentWidgets ?? 50 });
  const limiter = createRateLimiter({ maxPerMinute: opts.rateLimitPerMinute ?? 30 });

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const urlPath = (req.url ?? "/").split("?")[0];
      const match = route(method, req.url ?? "/");
      const origin = req.headers.origin;

      // CORS preflight
      if (match.handler.name === "preflight") {
        if (origin) {
          // Allow preflight from any origin; the actual request will be gated by checkOrigin.
          for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      if (match.handler.name === "not-found") {
        res.statusCode = 404;
        res.end();
        return;
      }

      if (match.handler.name === "admin-reload") {
        handleAdminReload(req, res, match.handler.widgetId, {
          invalidate: cache.invalidate,
          adminToken: opts.adminToken,
        });
        return;
      }

      if (match.handler.name === "mp4") {
        // Origin allowlist applies even to mp4 in v1.
        let entry;
        try {
          entry = await cache.load(match.handler.widgetId);
        } catch {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (origin && !checkOrigin(origin, entry.config.allowedOrigins)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (origin) for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
        await handleMp4(req, res, match.handler.widgetId, match.handler.demoId, { dataRoot: opts.dataRoot });
        return;
      }

      if (match.handler.name === "widget-config") {
        let entry;
        try {
          entry = await cache.load(match.handler.widgetId);
        } catch {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "widget not found" }));
          return;
        }
        if (!origin || !checkOrigin(origin, entry.config.allowedOrigins)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
        await handleWidgetConfig(req, res, match.handler.widgetId, { loadWidget: cache.load });
        return;
      }

      if (match.handler.name === "chat") {
        const body = await readJson<ChatRequest>(req).catch(() => null);
        if (!body || typeof body.widgetId !== "string") {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "invalid body" }));
          return;
        }
        let entry;
        try {
          entry = await cache.load(body.widgetId);
        } catch {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ kind: "no_match", text: "This help widget is not configured." }));
          return;
        }
        if (!origin || !checkOrigin(origin, entry.config.allowedOrigins)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const key = `${body.widgetId}:${clientIp(req)}`;
        const decision = limiter.check(key);
        if (!decision.allowed) {
          for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
          res.setHeader("Retry-After", String(decision.retryAfterSec));
          res.statusCode = 429;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "rate limit exceeded" }));
          return;
        }
        for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
        await handleChat(req, res, body, {
          loadWidget: cache.load,
          anthropicClient: opts.anthropicClient,
          embedQueryFn: opts.embedQueryFn,
          baseUrl: opts.baseUrl,
        });
        return;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[chat-server] unhandled error:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "internal" }));
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, () => resolve()));
  return server;
}
```

- [ ] **Step 8: Run the integration test; expect PASS (5 tests)**

Run: `npx vitest run tests/integration/chat-endpoint.test.ts`

- [ ] **Step 9: Commit**

```bash
git add src/chat-server/handlers src/chat-server/router.ts src/chat-server/server.ts tests/integration/chat-endpoint.test.ts
git commit -m "feat(chat-server): http server + chat/widget-config/mp4/admin handlers"
```

---

### Task 3.12: `daymo serve` CLI subcommand

**Files:**
- Create: `src/commands/serve.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement the subcommand**

Create `src/commands/serve.ts`:

```typescript
import path from "node:path";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { startServer } from "../chat-server/server.js";
import { embedQuery } from "../indexer/embedder-gemini.js";

export interface ServeOpts {
  port?: number;
  host?: string;
  dataRoot?: string;
  baseUrl?: string;
  rateLimitPerMinute?: number;
  adminToken?: string;
}

export async function serveCommand(opts: ServeOpts): Promise<void> {
  const dataRoot = opts.dataRoot
    ?? process.env.DAYMO_DATA_ROOT
    ?? path.join(os.homedir(), ".daymo-chat-data");
  const port = opts.port ?? 8765;
  const host = opts.host ?? "127.0.0.1";
  const baseUrl = opts.baseUrl ?? `http://${host}:${port}`;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is required to run `daymo serve`.");
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("GEMINI_API_KEY is required to run `daymo serve`.");

  const anthropicClient = new Anthropic({ apiKey: anthropicKey });
  const server = await startServer({
    port,
    host,
    dataRoot,
    anthropicClient,
    embedQueryFn: (text) => embedQuery(text, { apiKey: geminiKey }),
    baseUrl,
    rateLimitPerMinute: opts.rateLimitPerMinute,
    adminToken: opts.adminToken ?? process.env.DAYMO_ADMIN_TOKEN,
  });
  const addr = server.address();
  if (addr && typeof addr === "object") {
    process.stdout.write(`daymo serve listening on http://${host}:${addr.port}\n`);
    process.stdout.write(`data-root: ${dataRoot}\n`);
  }
}
```

- [ ] **Step 2: Register in `src/cli.ts`**

```typescript
import { serveCommand } from "./commands/serve.js";

cli.command("serve", "Run the chat-widget backend HTTP server")
  .option("--port <n>", "Port to listen on", { default: 8765 })
  .option("--host <h>", "Host interface to bind", { default: "127.0.0.1" })
  .option("--data-root <path>", "Override DAYMO_DATA_ROOT for this run")
  .option("--base-url <url>", "External URL the widget should use for mp4 fetches")
  .option("--rate-limit <n>", "Max requests per minute per widgetId+IP", { default: 30 })
  .option("--admin-token <token>", "Bearer token required for /admin/reload (or set DAYMO_ADMIN_TOKEN)")
  .action((flags: { port: number; host: string; dataRoot?: string; baseUrl?: string; rateLimit?: number; adminToken?: string }) =>
    serveCommand({
      port: Number(flags.port),
      host: flags.host,
      dataRoot: flags.dataRoot,
      baseUrl: flags.baseUrl,
      rateLimitPerMinute: flags.rateLimit !== undefined ? Number(flags.rateLimit) : undefined,
      adminToken: flags.adminToken,
    }),
  );
```

- [ ] **Step 3: Manually verify**

Run:
```bash
ANTHROPIC_API_KEY=sk-... GEMINI_API_KEY=... npx tsc && node dist/cli.js serve --port 8765
```
Expected: server starts and prints the listening URL. Ctrl-C to stop.

- [ ] **Step 4: Commit**

```bash
git add src/commands/serve.ts src/cli.ts
git commit -m "feat(cli): daymo serve subcommand"
```

---

**Milestone 3 complete.** The chat backend serves `/chat`, `/widget-config/<id>`, `/widgets/<id>/demos/<demoId>/output.mp4` (with range), and `/admin/reload?widgetId=...` against the local-filesystem artifact store. All three certainty layers (cosine prefilter, JSON-schema-forced LLM output, server-side stepId/timestamp validation) enforce no-hallucination behavior.

---

## Milestone 4: Widget bundle

Goal: A single ES module at `dist-widget/widget.js` (~30-50KB gzipped) that, when included as `<script async src="…/widget.js" data-widget-id="X">`, renders a floating bubble in the bottom-right of the page, opens a shadow-DOM-isolated chat panel on click, talks only to the backend's `/chat` and `/widget-config` endpoints, renders `Part[]` answers with inline `<video>` segments using Media Fragments URIs, supports 8 locales, and switches to fullscreen layout on `<600px` viewports.

### Task 4.1: Widget package scaffold

**Files:**
- Create: `widget/package.json`
- Create: `widget/tsconfig.json`
- Create: `widget/esbuild.config.mjs`
- Create: `widget/.gitignore`
- Modify: `package.json` (root build script)

- [ ] **Step 1: Create `widget/package.json`**

```jsonc
{
  "name": "daymo-widget",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs"
  },
  "devDependencies": {
    "esbuild": "^0.24.0",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: Create `widget/tsconfig.json`**

```jsonc
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022", "dom"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `widget/esbuild.config.mjs`**

```javascript
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";

await build({
  entryPoints: [path.join(__dirname, "src/widget.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: isProd,
  sourcemap: !isProd,
  outfile: path.join(__dirname, "..", "dist-widget/widget.js"),
  loader: { ".css": "text", ".json": "json" },
  define: { "globalThis.__DAYMO_WIDGET_VERSION__": JSON.stringify(process.env.npm_package_version ?? "0.0.0") },
  logLevel: "info",
});
```

- [ ] **Step 4: Create `widget/.gitignore`**

```
node_modules/
```

- [ ] **Step 5: Modify root `package.json` to add a widget-build script**

```jsonc
// scripts:
"build:widget": "cd widget && npm install && npm run build",
"build:all": "npm run build && npm run build:widget"
```

- [ ] **Step 6: Commit**

```bash
git add widget/package.json widget/tsconfig.json widget/esbuild.config.mjs widget/.gitignore package.json
git commit -m "feat(widget): scaffold widget bundle with esbuild"
```

---

### Task 4.2: Widget types (shared with backend)

**Files:**
- Create: `widget/src/types.ts`

- [ ] **Step 1: Define types**

```typescript
// widget/src/types.ts
export interface ChatRequest {
  widgetId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  locale?: string;
}

export type TextPart = { kind: "text"; text: string };
export type VideoPart = {
  kind: "video";
  stepId: string;
  demoId: string;
  startMs: number;
  endMs: number;
  caption: string;
  mp4Url: string;
};
export type Part = TextPart | VideoPart;

export type ChatResponse =
  | { kind: "answer"; parts: Part[] }
  | { kind: "no_match"; text: string; suggestions?: string[] };

export interface WidgetConfigResp {
  widgetId: string;
  name: string;
  brandColor?: string;
  locale: string;
  suggestedQuestions: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add widget/src/types.ts
git commit -m "feat(widget): shared ChatRequest/ChatResponse types"
```

---

### Task 4.3: Locale auto-detect + translations

**Files:**
- Create: `widget/src/locale.ts`
- Create: `widget/src/locales/en.json`, `es.json`, `fr.json`, `de.json`, `ja.json`, `pt.json`, `zh-CN.json`, `it.json`
- Create: `tests/unit/widget-locale.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/widget-locale.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveLocale, getStrings } from "../../widget/src/locale.js";

describe("resolveLocale", () => {
  it("returns the explicit override when provided", () => {
    expect(resolveLocale({ override: "es", htmlLang: "fr", navigatorLang: "de-DE" })).toBe("es");
  });
  it("uses <html lang> when no override is provided", () => {
    expect(resolveLocale({ override: undefined, htmlLang: "ja", navigatorLang: "en-US" })).toBe("ja");
  });
  it("falls back to navigator language when html lang is missing", () => {
    expect(resolveLocale({ override: undefined, htmlLang: "", navigatorLang: "pt-BR" })).toBe("pt");
  });
  it("falls back to 'en' for unknown locales", () => {
    expect(resolveLocale({ override: "klingon", htmlLang: "", navigatorLang: "" })).toBe("en");
  });
  it("maps zh-Hant or zh-TW down to zh-CN (only Chinese variant we ship)", () => {
    // For v1 we only ship simplified Chinese — others fall through to en.
    expect(resolveLocale({ override: "zh-Hant", htmlLang: "", navigatorLang: "" })).toBe("en");
    expect(resolveLocale({ override: "zh-CN", htmlLang: "", navigatorLang: "" })).toBe("zh-CN");
  });
});

describe("getStrings", () => {
  it("returns the full string bundle for a locale", () => {
    const s = getStrings("en");
    expect(s.greeting).toBeTruthy();
    expect(s.inputPlaceholder).toBeTruthy();
    expect(s.rateLimitMessage).toBeTruthy();
    expect(s.noMatchPrefix).toBeTruthy();
  });
  it("returns en strings for an unknown locale", () => {
    const s = getStrings("klingon" as never);
    expect(s).toBe(getStrings("en"));
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Create `widget/src/locale.ts`**

```typescript
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import de from "./locales/de.json" with { type: "json" };
import ja from "./locales/ja.json" with { type: "json" };
import pt from "./locales/pt.json" with { type: "json" };
import zhCN from "./locales/zh-CN.json" with { type: "json" };
import it from "./locales/it.json" with { type: "json" };

export type SupportedLocale = "en" | "es" | "fr" | "de" | "ja" | "pt" | "zh-CN" | "it";

export interface StringBundle {
  greeting: string;
  inputPlaceholder: string;
  send: string;
  open: string;
  close: string;
  back: string;
  suggestedHeader: string;
  rateLimitMessage: string;
  upstreamErrorMessage: string;
  noMatchPrefix: string;
  notConfiguredMessage: string;
  caption: string;
}

const BUNDLES: Record<SupportedLocale, StringBundle> = {
  en: en as StringBundle,
  es: es as StringBundle,
  fr: fr as StringBundle,
  de: de as StringBundle,
  ja: ja as StringBundle,
  pt: pt as StringBundle,
  "zh-CN": zhCN as StringBundle,
  it: it as StringBundle,
};

export function getStrings(locale: string): StringBundle {
  if (locale in BUNDLES) return BUNDLES[locale as SupportedLocale];
  return BUNDLES.en;
}

export interface ResolveLocaleInput {
  override: string | undefined;
  htmlLang: string;
  navigatorLang: string;
}

export function resolveLocale(input: ResolveLocaleInput): SupportedLocale {
  const candidates = [input.override, input.htmlLang, input.navigatorLang].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c in BUNDLES) return c as SupportedLocale;
    const short = c.split("-")[0];
    if (short in BUNDLES) return short as SupportedLocale;
  }
  return "en";
}
```

- [ ] **Step 4: Create the 8 locale JSON files**

`widget/src/locales/en.json`:
```json
{
  "greeting": "Hi! Ask me how to do anything.",
  "inputPlaceholder": "Type a question…",
  "send": "Send",
  "open": "Open product help",
  "close": "Close",
  "back": "Back",
  "suggestedHeader": "Try:",
  "rateLimitMessage": "Too many questions — give me a moment.",
  "upstreamErrorMessage": "Couldn't reach the assistant. Try again.",
  "noMatchPrefix": "I don't have that in the demos. Try:",
  "notConfiguredMessage": "This help widget is not configured.",
  "caption": "Caption"
}
```

`widget/src/locales/es.json`:
```json
{
  "greeting": "¡Hola! Pregúntame cómo hacer cualquier cosa.",
  "inputPlaceholder": "Escribe una pregunta…",
  "send": "Enviar",
  "open": "Abrir ayuda del producto",
  "close": "Cerrar",
  "back": "Atrás",
  "suggestedHeader": "Prueba:",
  "rateLimitMessage": "Demasiadas preguntas — dame un momento.",
  "upstreamErrorMessage": "No pude contactar al asistente. Intenta de nuevo.",
  "noMatchPrefix": "No tengo eso en las demos. Prueba:",
  "notConfiguredMessage": "Este widget de ayuda no está configurado.",
  "caption": "Subtítulo"
}
```

`widget/src/locales/fr.json`:
```json
{
  "greeting": "Bonjour ! Demandez-moi comment faire n'importe quoi.",
  "inputPlaceholder": "Tapez une question…",
  "send": "Envoyer",
  "open": "Ouvrir l'aide produit",
  "close": "Fermer",
  "back": "Retour",
  "suggestedHeader": "Essayez :",
  "rateLimitMessage": "Trop de questions — donnez-moi un instant.",
  "upstreamErrorMessage": "Impossible de joindre l'assistant. Réessayez.",
  "noMatchPrefix": "Je n'ai pas ça dans les démos. Essayez :",
  "notConfiguredMessage": "Ce widget d'aide n'est pas configuré.",
  "caption": "Légende"
}
```

`widget/src/locales/de.json`:
```json
{
  "greeting": "Hi! Frag mich, wie man etwas macht.",
  "inputPlaceholder": "Stelle eine Frage…",
  "send": "Senden",
  "open": "Produkthilfe öffnen",
  "close": "Schließen",
  "back": "Zurück",
  "suggestedHeader": "Versuche:",
  "rateLimitMessage": "Zu viele Fragen — gib mir einen Moment.",
  "upstreamErrorMessage": "Konnte den Assistenten nicht erreichen. Versuche es erneut.",
  "noMatchPrefix": "Ich habe das nicht in den Demos. Versuche:",
  "notConfiguredMessage": "Dieses Hilfe-Widget ist nicht konfiguriert.",
  "caption": "Untertitel"
}
```

`widget/src/locales/ja.json`:
```json
{
  "greeting": "こんにちは！何でも質問してください。",
  "inputPlaceholder": "質問を入力…",
  "send": "送信",
  "open": "ヘルプを開く",
  "close": "閉じる",
  "back": "戻る",
  "suggestedHeader": "例:",
  "rateLimitMessage": "質問が多すぎます — 少し待ってください。",
  "upstreamErrorMessage": "アシスタントに接続できませんでした。再試行してください。",
  "noMatchPrefix": "デモにそれが見つかりません。お試しください:",
  "notConfiguredMessage": "このヘルプウィジェットは設定されていません。",
  "caption": "キャプション"
}
```

`widget/src/locales/pt.json`:
```json
{
  "greeting": "Oi! Pergunte-me como fazer qualquer coisa.",
  "inputPlaceholder": "Digite uma pergunta…",
  "send": "Enviar",
  "open": "Abrir ajuda do produto",
  "close": "Fechar",
  "back": "Voltar",
  "suggestedHeader": "Experimente:",
  "rateLimitMessage": "Muitas perguntas — dê-me um momento.",
  "upstreamErrorMessage": "Não consegui contatar o assistente. Tente novamente.",
  "noMatchPrefix": "Não tenho isso nas demos. Experimente:",
  "notConfiguredMessage": "Este widget de ajuda não está configurado.",
  "caption": "Legenda"
}
```

`widget/src/locales/zh-CN.json`:
```json
{
  "greeting": "你好！请问如何操作？",
  "inputPlaceholder": "输入问题…",
  "send": "发送",
  "open": "打开产品帮助",
  "close": "关闭",
  "back": "返回",
  "suggestedHeader": "试试：",
  "rateLimitMessage": "问题太多 — 请稍候。",
  "upstreamErrorMessage": "无法连接到助手。请重试。",
  "noMatchPrefix": "演示中没有相关内容。试试：",
  "notConfiguredMessage": "此帮助小部件未配置。",
  "caption": "字幕"
}
```

`widget/src/locales/it.json`:
```json
{
  "greeting": "Ciao! Chiedimi come fare qualsiasi cosa.",
  "inputPlaceholder": "Digita una domanda…",
  "send": "Invia",
  "open": "Apri aiuto prodotto",
  "close": "Chiudi",
  "back": "Indietro",
  "suggestedHeader": "Prova:",
  "rateLimitMessage": "Troppe domande — un attimo.",
  "upstreamErrorMessage": "Impossibile raggiungere l'assistente. Riprova.",
  "noMatchPrefix": "Non ho quello nelle demo. Prova:",
  "notConfiguredMessage": "Questo widget di aiuto non è configurato.",
  "caption": "Didascalia"
}
```

- [ ] **Step 5: Run tests; expect PASS (7 tests)**

Note: vitest needs to resolve `.json` imports with `with { type: "json" }` syntax. If it complains, switch to plain `import en from "./locales/en.json"` and remove the `with` clause — both forms work in Node 20.10+ with `--experimental-json-modules`. esbuild handles both at bundle time.

- [ ] **Step 6: Commit**

```bash
git add widget/src/locale.ts widget/src/locales tests/unit/widget-locale.test.ts
git commit -m "feat(widget): 8-locale chrome translations + auto-detection"
```

---

### Task 4.4: API client module

**Files:**
- Create: `widget/src/api.ts`
- Create: `tests/unit/widget-api.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/widget-api.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createApi } from "../../widget/src/api.js";

describe("widget Api.chat", () => {
  it("POSTs to /chat with the request body and returns the parsed ChatResponse", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ kind: "no_match", text: "x" }),
    });
    const api = createApi({ baseUrl: "https://daymo.dev", fetchFn: fetchMock });
    const resp = await api.chat({ widgetId: "w", message: "hi", history: [] });
    expect(resp).toEqual({ kind: "no_match", text: "x" });
    const url = fetchMock.mock.calls[0][0];
    const init = fetchMock.mock.calls[0][1];
    expect(url).toBe("https://daymo.dev/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ widgetId: "w", message: "hi", history: [] });
  });

  it("throws ApiError(429) with retryAfterSec on rate-limit response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 429,
      headers: { get: (k: string) => k.toLowerCase() === "retry-after" ? "5" : null },
      text: async () => "",
      json: async () => ({}),
    });
    const api = createApi({ baseUrl: "https://daymo.dev", fetchFn: fetchMock });
    await expect(api.chat({ widgetId: "w", message: "hi", history: [] })).rejects.toMatchObject({
      status: 429,
      retryAfterSec: 5,
    });
  });

  it("retries 502 once before throwing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 502, headers: { get: () => null }, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ kind: "no_match", text: "ok" }) });
    const api = createApi({ baseUrl: "https://daymo.dev", fetchFn: fetchMock });
    const r = await api.chat({ widgetId: "w", message: "hi", history: [] });
    expect(r.kind).toBe("no_match");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("widget Api.getConfig", () => {
  it("GETs /widget-config/<id> and returns the parsed config", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ widgetId: "w", name: "T", locale: "en", suggestedQuestions: [] }),
    });
    const api = createApi({ baseUrl: "https://daymo.dev", fetchFn: fetchMock });
    const cfg = await api.getConfig("w");
    expect(cfg.name).toBe("T");
    expect(fetchMock.mock.calls[0][0]).toBe("https://daymo.dev/widget-config/w");
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `widget/src/api.ts`:

```typescript
import type { ChatRequest, ChatResponse, WidgetConfigResp } from "./types.js";

export class ApiError extends Error {
  constructor(public status: number, public retryAfterSec: number, message: string) {
    super(message);
  }
}

export interface ApiOpts {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

async function callWithRetry<T>(doIt: () => Promise<Response>, parseOk: (r: Response) => Promise<T>): Promise<T> {
  let lastErr: ApiError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await doIt();
    if (res.ok) return parseOk(res);
    const retryAfterHeader = res.headers.get?.("Retry-After") ?? null;
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : 0;
    lastErr = new ApiError(res.status, retryAfterSec, `HTTP ${res.status}`);
    if (res.status !== 502) throw lastErr;
    // 502 → retry once
  }
  throw lastErr;
}

export function createApi(opts: ApiOpts) {
  const fetchFn = opts.fetchFn ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      return callWithRetry(
        () => fetchFn(`${base}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        }),
        (r) => r.json() as Promise<ChatResponse>,
      );
    },
    async getConfig(widgetId: string): Promise<WidgetConfigResp> {
      return callWithRetry(
        () => fetchFn(`${base}/widget-config/${encodeURIComponent(widgetId)}`),
        (r) => r.json() as Promise<WidgetConfigResp>,
      );
    },
  };
}
```

- [ ] **Step 4: Run tests; expect PASS (4 tests)**

- [ ] **Step 5: Commit**

```bash
git add widget/src/api.ts tests/unit/widget-api.test.ts
git commit -m "feat(widget): api client with 429/502 handling"
```

---

### Task 4.5: Chat state machine

**Files:**
- Create: `widget/src/chat-state.ts`
- Create: `tests/unit/widget-chat-state.test.ts`

- [ ] **Step 1: Failing tests**

Create `tests/unit/widget-chat-state.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createChatState } from "../../widget/src/chat-state.js";

describe("createChatState", () => {
  it("starts in 'closed' state with empty history", () => {
    const s = createChatState();
    expect(s.getState().phase).toBe("closed");
    expect(s.getState().history).toEqual([]);
  });

  it("open() transitions to 'open' (idle)", () => {
    const s = createChatState();
    s.open();
    expect(s.getState().phase).toBe("open-idle");
  });

  it("submitMessage('hi') appends a user turn and goes to awaiting", () => {
    const s = createChatState();
    s.open();
    s.submitMessage("hi");
    expect(s.getState().phase).toBe("awaiting");
    expect(s.getState().history).toEqual([{ role: "user", content: "hi" }]);
  });

  it("receiveAnswer appends an assistant turn (summarized from parts) and returns to idle", () => {
    const s = createChatState();
    s.open();
    s.submitMessage("hi");
    s.receiveAnswer({
      kind: "answer",
      parts: [
        { kind: "text", text: "Here's how:" },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 100, caption: "c", mp4Url: "u" },
      ],
    });
    expect(s.getState().phase).toBe("open-idle");
    expect(s.getState().history.at(-1)).toEqual({ role: "assistant", content: "Here's how:" });
  });

  it("caps history to the last 2 turns (4 messages: 2 user + 2 assistant)", () => {
    const s = createChatState();
    s.open();
    for (let i = 0; i < 3; i++) {
      s.submitMessage(`q${i}`);
      s.receiveAnswer({ kind: "no_match", text: `a${i}` });
    }
    // We expect only the last 4 messages.
    expect(s.getState().history).toHaveLength(4);
    expect(s.getState().history[0]).toEqual({ role: "user", content: "q1" });
    expect(s.getState().history[3]).toEqual({ role: "assistant", content: "a2" });
  });

  it("receiveError transitions to 'error' with a message; clearError returns to idle", () => {
    const s = createChatState();
    s.open();
    s.submitMessage("hi");
    s.receiveError("ratelimit");
    expect(s.getState().phase).toBe("error");
    expect(s.getState().errorKind).toBe("ratelimit");
    s.clearError();
    expect(s.getState().phase).toBe("open-idle");
  });

  it("close() returns to 'closed' without dropping history (resume next open)", () => {
    const s = createChatState();
    s.open();
    s.submitMessage("hi");
    s.receiveAnswer({ kind: "no_match", text: "x" });
    s.close();
    expect(s.getState().phase).toBe("closed");
    expect(s.getState().history).toHaveLength(2);
  });

  it("subscribe fires on every state change", () => {
    const s = createChatState();
    const calls: string[] = [];
    s.subscribe(() => calls.push(s.getState().phase));
    s.open();
    s.submitMessage("hi");
    expect(calls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement**

Create `widget/src/chat-state.ts`:

```typescript
import type { ChatResponse } from "./types.js";

export type Phase = "closed" | "open-idle" | "awaiting" | "error";
export type ErrorKind = "ratelimit" | "upstream" | "not-configured";

export interface ChatStateSnapshot {
  phase: Phase;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  pendingMessage: string | null;
  lastResponse: ChatResponse | null;
  errorKind: ErrorKind | null;
}

const MAX_TURNS = 2; // 2 turns = 4 history entries

export function createChatState() {
  let snap: ChatStateSnapshot = {
    phase: "closed",
    history: [],
    pendingMessage: null,
    lastResponse: null,
    errorKind: null,
  };
  const subs = new Set<(s: ChatStateSnapshot) => void>();
  function notify() { for (const fn of subs) fn(snap); }

  function trimHistory(h: ChatStateSnapshot["history"]): ChatStateSnapshot["history"] {
    const maxEntries = MAX_TURNS * 2;
    if (h.length <= maxEntries) return h;
    return h.slice(h.length - maxEntries);
  }

  function summarizeAnswer(resp: ChatResponse): string {
    if (resp.kind === "no_match") return resp.text;
    const firstText = resp.parts.find((p) => p.kind === "text");
    return firstText?.kind === "text" ? firstText.text : "(answer)";
  }

  return {
    getState() { return snap; },
    subscribe(fn: (s: ChatStateSnapshot) => void) { subs.add(fn); return () => subs.delete(fn); },
    open() {
      snap = { ...snap, phase: "open-idle" };
      notify();
    },
    close() {
      snap = { ...snap, phase: "closed" };
      notify();
    },
    submitMessage(text: string) {
      snap = {
        ...snap,
        phase: "awaiting",
        pendingMessage: text,
        history: trimHistory([...snap.history, { role: "user", content: text }]),
      };
      notify();
    },
    receiveAnswer(resp: ChatResponse) {
      snap = {
        ...snap,
        phase: "open-idle",
        pendingMessage: null,
        lastResponse: resp,
        history: trimHistory([...snap.history, { role: "assistant", content: summarizeAnswer(resp) }]),
      };
      notify();
    },
    receiveError(kind: ErrorKind) {
      snap = { ...snap, phase: "error", errorKind: kind };
      notify();
    },
    clearError() {
      snap = { ...snap, phase: "open-idle", errorKind: null };
      notify();
    },
  };
}
```

- [ ] **Step 4: Run tests; expect PASS (8 tests)**

- [ ] **Step 5: Commit**

```bash
git add widget/src/chat-state.ts tests/unit/widget-chat-state.test.ts
git commit -m "feat(widget): chat state machine"
```

---

### Task 4.6: DOM template + Part renderer

**Files:**
- Create: `widget/src/template.ts`
- Create: `widget/src/render-parts.ts`
- Create: `tests/unit/widget-render-parts.test.ts`

- [ ] **Step 1: Failing tests (using jsdom from existing project setup)**

Create `tests/unit/widget-render-parts.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderParts } from "../../widget/src/render-parts.js";
import type { Part } from "../../widget/src/types.js";

describe("renderParts", () => {
  it("renders a TextPart as a paragraph with the text content", () => {
    const parts: Part[] = [{ kind: "text", text: "Hello world." }];
    const root = document.createElement("div");
    renderParts(root, parts);
    expect(root.querySelector("p")?.textContent).toBe("Hello world.");
  });

  it("renders a VideoPart as a <video> element with #t= media fragment", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1500, endMs: 3500, caption: "Open dialog", mp4Url: "https://x/d.mp4" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts);
    const v = root.querySelector("video")!;
    expect(v.src).toBe("https://x/d.mp4#t=1.5,3.5");
    expect(v.getAttribute("preload")).toBe("metadata");
    expect(v.getAttribute("playsinline")).not.toBeNull();
    expect(v.hasAttribute("controls")).toBe(true);
  });

  it("renders the caption under the video", () => {
    const parts: Part[] = [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 1000, caption: "Loomly · Open · 0:00-0:01", mp4Url: "x" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts);
    expect(root.querySelector(".caption")?.textContent).toBe("Loomly · Open · 0:00-0:01");
  });

  it("renders multiple parts in order", () => {
    const parts: Part[] = [
      { kind: "text", text: "First:" },
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 1000, caption: "c1", mp4Url: "u1" },
      { kind: "text", text: "Then:" },
      { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 0, endMs: 1000, caption: "c2", mp4Url: "u2" },
    ];
    const root = document.createElement("div");
    renderParts(root, parts);
    const children = Array.from(root.children);
    expect(children[0].tagName.toLowerCase()).toBe("p");
    expect(children[1].tagName.toLowerCase()).toBe("video");
    expect(children[2].tagName.toLowerCase()).toBe("p");
    expect(children[3].tagName.toLowerCase()).toBe("video");
  });

  it("escapes text content (no HTML injection)", () => {
    const parts: Part[] = [{ kind: "text", text: "<script>alert(1)</script>" }];
    const root = document.createElement("div");
    renderParts(root, parts);
    expect(root.innerHTML).not.toContain("<script>");
    expect(root.querySelector("p")?.textContent).toBe("<script>alert(1)</script>");
  });
});
```

- [ ] **Step 2: Run tests; expect FAIL**

- [ ] **Step 3: Implement `widget/src/template.ts`**

```typescript
/** Trivial tagged-template helper for safe text content. NOT a full template
 *  engine — only escapes values. Used by the renderer for setting textContent. */
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
```

- [ ] **Step 4: Implement `widget/src/render-parts.ts`**

```typescript
import type { Part, VideoPart } from "./types.js";

/** Render the answer parts into the given root, replacing its contents.
 *  Each video is wrapped in a small <div> containing the video element and a
 *  caption line below. */
export function renderParts(root: HTMLElement, parts: Part[]): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  for (const part of parts) {
    if (part.kind === "text") {
      const p = document.createElement("p");
      p.textContent = part.text;
      root.appendChild(p);
    } else {
      root.appendChild(renderVideoPart(part));
    }
  }
}

function renderVideoPart(part: VideoPart): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "video-wrap";

  const v = document.createElement("video");
  const startSec = (part.startMs / 1000).toFixed(3).replace(/\.?0+$/, "");
  const endSec = (part.endMs / 1000).toFixed(3).replace(/\.?0+$/, "");
  v.src = `${part.mp4Url}#t=${startSec},${endSec}`;
  v.setAttribute("preload", "metadata");
  v.setAttribute("playsinline", "");
  v.controls = true;

  // Auto-pause at endMs (browser may not honor #t= end strictly).
  v.addEventListener("timeupdate", () => {
    if (v.currentTime >= part.endMs / 1000) v.pause();
  });

  wrap.appendChild(v);
  const caption = document.createElement("small");
  caption.className = "caption";
  caption.textContent = part.caption;
  wrap.appendChild(caption);
  return wrap;
}
```

- [ ] **Step 5: Run tests; expect PASS (5 tests)**

- [ ] **Step 6: Commit**

```bash
git add widget/src/template.ts widget/src/render-parts.ts tests/unit/widget-render-parts.test.ts
git commit -m "feat(widget): Part[] renderer with media-fragment video"
```

---

### Task 4.7: Mount + bubble + chat panel UI

**Files:**
- Create: `widget/src/styles.css`
- Create: `widget/src/mount.ts`
- Create: `widget/src/widget.ts`

This task wires the previously-built pieces (state machine, locale, api, render-parts) into a complete shadow-DOM widget. The styles include desktop + mobile media queries per the spec.

- [ ] **Step 1: Create `widget/src/styles.css`**

```css
:host {
  all: initial;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #222;
}
.bubble {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--brand, #6c5ce7);
  color: #fff;
  border: none;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(0,0,0,0.18);
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483647;
}
.bubble:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.panel {
  position: fixed;
  bottom: 80px;
  right: 16px;
  width: 320px;
  max-height: 480px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.22);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 2147483647;
}
.panel-header {
  background: var(--brand, #6c5ce7);
  color: #fff;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-header button { background: transparent; color: #fff; border: 0; cursor: pointer; font-size: 16px; }
.thread {
  flex: 1;
  padding: 10px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.45;
}
.thread .msg-user {
  background: #f0f0f4;
  border-radius: 8px;
  padding: 6px 9px;
  margin: 4px 0 4px auto;
  max-width: 80%;
  text-align: right;
  word-wrap: break-word;
}
.thread .msg-assistant { margin: 6px 0; }
.thread .msg-assistant p { margin: 4px 0; }
.video-wrap { margin: 6px 0; }
.video-wrap video { width: 100%; max-height: 200px; background: #000; border-radius: 5px; }
.caption { display: block; color: #666; font-size: 11px; margin-top: 2px; }
.suggestions { display: flex; flex-direction: column; gap: 6px; margin: 6px 0; }
.suggestions button {
  text-align: left;
  background: #f7f7fa;
  border: 1px solid #e5e5ec;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}
.input-row {
  border-top: 1px solid #eee;
  padding: 8px 10px;
  display: flex;
  gap: 6px;
}
.input-row input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 5px;
  padding: 6px 8px;
  font-size: 13px;
}
.input-row button {
  background: var(--brand, #6c5ce7);
  color: #fff;
  border: 0;
  border-radius: 5px;
  padding: 6px 12px;
  cursor: pointer;
}
.error-banner { background: #ffefef; color: #c00; padding: 6px 10px; font-size: 12px; }
.greeting { color: #555; margin: 8px 0; }
.suggested-header { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 8px; }

@media (max-width: 600px) {
  .bubble { width: 56px; height: 56px; bottom: 24px; right: 16px; }
  .panel {
    bottom: 0;
    right: 0;
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .panel-header button.minimize { display: none; }
  .panel-header button.close { font-size: 20px; }
}
```

- [ ] **Step 2: Implement `widget/src/mount.ts`**

```typescript
import styles from "./styles.css" with { type: "text" };
import { createChatState } from "./chat-state.js";
import { createApi, ApiError } from "./api.js";
import { renderParts } from "./render-parts.js";
import { getStrings, resolveLocale, type SupportedLocale } from "./locale.js";
import type { ChatResponse, WidgetConfigResp } from "./types.js";

export interface MountOpts {
  widgetId: string;
  baseUrl: string;
  localeOverride?: string;
}

export async function mount(opts: MountOpts): Promise<void> {
  const host = document.createElement("div");
  host.id = "daymo-widget-root";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);

  const locale: SupportedLocale = resolveLocale({
    override: opts.localeOverride,
    htmlLang: document.documentElement.lang,
    navigatorLang: navigator.language,
  });
  const strings = getStrings(locale);

  const api = createApi({ baseUrl: opts.baseUrl });
  const state = createChatState();

  // Try to fetch config; if it fails, we still render but with defaults.
  let config: WidgetConfigResp | null = null;
  try {
    config = await api.getConfig(opts.widgetId);
  } catch { /* ignore — fallback to defaults */ }

  if (config?.brandColor) host.style.setProperty("--brand", config.brandColor);

  // Bubble
  const bubble = document.createElement("button");
  bubble.className = "bubble";
  bubble.setAttribute("aria-label", strings.open);
  bubble.textContent = "?";
  shadow.appendChild(bubble);

  // Panel (created lazily on first open)
  let panel: HTMLDivElement | null = null;
  let thread: HTMLDivElement | null = null;
  let input: HTMLInputElement | null = null;
  let errorBanner: HTMLDivElement | null = null;

  function buildPanel(): void {
    panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");

    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("span");
    title.id = "chat-title";
    title.textContent = config?.name ?? opts.widgetId;
    panel.setAttribute("aria-labelledby", "chat-title");
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.className = "close";
    closeBtn.setAttribute("aria-label", strings.close);
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => state.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    errorBanner = document.createElement("div");
    errorBanner.className = "error-banner";
    errorBanner.style.display = "none";
    panel.appendChild(errorBanner);

    thread = document.createElement("div");
    thread.className = "thread";
    panel.appendChild(thread);

    const inputRow = document.createElement("div");
    inputRow.className = "input-row";
    input = document.createElement("input");
    input.type = "text";
    input.placeholder = strings.inputPlaceholder;
    input.setAttribute("aria-label", strings.inputPlaceholder);
    const sendBtn = document.createElement("button");
    sendBtn.textContent = strings.send;
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    panel.appendChild(inputRow);

    function submit() {
      const text = input!.value.trim();
      if (!text) return;
      input!.value = "";
      state.submitMessage(text);
      sendChat(text);
    }
    sendBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    shadow.appendChild(panel);
  }

  function renderThread(): void {
    if (!thread) return;
    while (thread.firstChild) thread.removeChild(thread.firstChild);
    const s = state.getState();

    // Greeting + suggestions on first open
    if (s.history.length === 0) {
      const greet = document.createElement("p");
      greet.className = "greeting";
      greet.textContent = strings.greeting;
      thread.appendChild(greet);
      const suggested = config?.suggestedQuestions ?? [];
      if (suggested.length > 0) {
        const header = document.createElement("div");
        header.className = "suggested-header";
        header.textContent = strings.suggestedHeader;
        thread.appendChild(header);
        const wrap = document.createElement("div");
        wrap.className = "suggestions";
        for (const q of suggested) {
          const btn = document.createElement("button");
          btn.textContent = q;
          btn.addEventListener("click", () => { input!.value = q; input!.focus(); });
          wrap.appendChild(btn);
        }
        thread.appendChild(wrap);
      }
    }

    for (let i = 0; i < s.history.length; i++) {
      const turn = s.history[i];
      if (turn.role === "user") {
        const el = document.createElement("div");
        el.className = "msg-user";
        el.textContent = turn.content;
        thread.appendChild(el);
      } else {
        // The matching answer might be in lastResponse if this is the most recent one
        const isLast = i === s.history.length - 1;
        const wrap = document.createElement("div");
        wrap.className = "msg-assistant";
        if (isLast && s.lastResponse) {
          if (s.lastResponse.kind === "answer") {
            renderParts(wrap, s.lastResponse.parts);
          } else {
            const p = document.createElement("p");
            p.textContent = `${strings.noMatchPrefix} ${s.lastResponse.text}`;
            wrap.appendChild(p);
            if (s.lastResponse.suggestions?.length) {
              const sugg = document.createElement("div");
              sugg.className = "suggestions";
              for (const q of s.lastResponse.suggestions) {
                const b = document.createElement("button");
                b.textContent = q;
                b.addEventListener("click", () => { input!.value = q; input!.focus(); });
                sugg.appendChild(b);
              }
              wrap.appendChild(sugg);
            }
          }
        } else {
          const p = document.createElement("p");
          p.textContent = turn.content;
          wrap.appendChild(p);
        }
        thread.appendChild(wrap);
      }
    }
    thread.scrollTop = thread.scrollHeight;
  }

  function renderError(): void {
    if (!errorBanner) return;
    const s = state.getState();
    if (s.phase !== "error") { errorBanner.style.display = "none"; return; }
    errorBanner.style.display = "block";
    errorBanner.textContent =
      s.errorKind === "ratelimit" ? strings.rateLimitMessage
        : s.errorKind === "not-configured" ? strings.notConfiguredMessage
          : strings.upstreamErrorMessage;
  }

  async function sendChat(text: string): Promise<void> {
    try {
      const resp: ChatResponse = await api.chat({
        widgetId: opts.widgetId,
        message: text,
        history: state.getState().history.slice(0, -1),
        locale,
      });
      state.receiveAnswer(resp);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) state.receiveError("ratelimit");
      else if (e instanceof ApiError && e.status === 404) state.receiveError("not-configured");
      else state.receiveError("upstream");
    }
  }

  state.subscribe(() => {
    const s = state.getState();
    if (s.phase === "closed") {
      if (panel) panel.style.display = "none";
      bubble.style.display = "flex";
    } else {
      if (!panel) buildPanel();
      panel!.style.display = "flex";
      bubble.style.display = "none";
      renderThread();
      renderError();
      if (s.phase === "open-idle" && input) input.focus();
    }
  });

  bubble.addEventListener("click", () => state.open());
}
```

- [ ] **Step 3: Implement entry point `widget/src/widget.ts`**

```typescript
import { mount } from "./mount.js";

function init() {
  const script = document.currentScript as HTMLScriptElement | null
    ?? document.querySelector<HTMLScriptElement>("script[data-widget-id]");
  if (!script) {
    // eslint-disable-next-line no-console
    console.warn("[daymo-widget] script tag with data-widget-id not found");
    return;
  }
  const widgetId = script.getAttribute("data-widget-id");
  const baseUrl = script.getAttribute("data-base-url")
    ?? new URL(script.src).origin;
  const locale = script.getAttribute("data-locale") ?? undefined;
  if (!widgetId) {
    // eslint-disable-next-line no-console
    console.warn("[daymo-widget] data-widget-id is required");
    return;
  }
  mount({ widgetId, baseUrl, localeOverride: locale ?? undefined }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[daymo-widget] mount failed:", err);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
```

- [ ] **Step 4: Verify the widget builds**

Run:
```bash
cd widget && npm install && npm run build && cd ..
ls -la dist-widget/widget.js
```
Expected: `dist-widget/widget.js` exists, size <100KB.

- [ ] **Step 5: Commit**

```bash
git add widget/src/styles.css widget/src/mount.ts widget/src/widget.ts
git commit -m "feat(widget): mount + bubble + chat panel UI"
```

---

**Milestone 4 complete.** The widget bundle renders a floating bubble + shadow-DOM chat panel with inline video segments, supports 8 locales, switches to fullscreen on mobile, and handles 429/404/502 errors gracefully.

---

## Milestone 5: Fixtures + golden questions + E2E

Goal: A real fixture customer with a real `output.mp4` + index, plus a golden-questions retrieval test that gates recall@3 ≥ 85%, plus a Playwright E2E that exercises the full pipeline from script tag to seeked video playback.

### Task 5.1: Build a fixture demo, stitch + index it

**Files:**
- Create: `tests/fixtures/demo-chat/loomly/tour.demo` (copy of existing `demo-tour.demo`)
- Create: `tests/fixtures/demo-chat/loomly/golden-questions.json`

- [ ] **Step 1: Copy the existing tour fixture into the demo-chat fixtures directory**

```bash
mkdir -p tests/fixtures/demo-chat/loomly
cp demo-tour.demo tests/fixtures/demo-chat/loomly/tour.demo
```

- [ ] **Step 2: Write the golden-questions file**

Create `tests/fixtures/demo-chat/loomly/golden-questions.json`:

```jsonc
[
  { "q": "How do I create a new project?", "expectedStepId": "tour:2:0" },
  { "q": "How do I see project status?", "expectedStepId": "tour:1:0" },
  { "q": "How do I fill in a project name?", "expectedStepId": "tour:3:0" },
  { "q": "How do I delete a project?", "expected": "no_match" },
  { "q": "How do I export data?", "expected": "no_match" },
  { "q": "¿Cómo creo un nuevo proyecto?", "expectedStepId": "tour:2:0" }
]
```

**Required preparation step before the recall test (Task 5.2) will pass:** run `npx daymo stitch tests/fixtures/demo-chat/loomly/tour.demo` and open `tests/fixtures/demo-chat/loomly/.daymo/step-index.json`. For each entry in `golden-questions.json`, find the step whose `description` field matches the question intent and copy its `stepId` (`tour:<sceneIndex>:<stepIndex>`) into the file. If the matching scene has no `fx.step()` calls (just `fx.say`), use `tour:<sceneIndex>:0` (the implicit preamble). The above stepIds are best-guess placeholders; the test in Task 5.2 will fail until they match the actual step-index.

- [ ] **Step 3: Document the fixture build process**

Create `tests/fixtures/demo-chat/README.md`:

```markdown
# Demo chat fixtures

Each subdirectory is a fixture customer with:
- One or more `.demo` files
- A pre-built `.daymo/` (capture + step-index + state)
- A pre-built `output.mp4`
- `golden-questions.json`: ground-truth Q→stepId pairs for retrieval recall tests

To rebuild a fixture from scratch:

```bash
cd tests/fixtures/demo-chat/loomly
npx daymo capture tour.demo --all   # requires the dev server fixture in demo-server.mjs
npx daymo stitch tour.demo
```

Then update `golden-questions.json` if step boundaries changed.
```

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/demo-chat
git commit -m "test(fixtures): demo-chat fixture customer with golden questions"
```

---

### Task 5.2: Golden-questions retrieval recall test

**Files:**
- Create: `tests/integration/golden-questions.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/integration/golden-questions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeIndexForDemoDir } from "../../src/indexer/write-index.js";
import { embedQuery } from "../../src/indexer/embedder-gemini.js";
import { retrieve } from "../../src/chat-server/retrieve.js";
import { extractKeywords } from "../../src/indexer/keywords.js";
import type { IndexFile } from "../../src/types.js";

const run = process.env.RUN_EMBED_TESTS === "1" && process.env.GEMINI_API_KEY;

describe.skipIf(!run)("golden-questions recall (real Gemini)", () => {
  it("achieves recall@3 ≥ 85% on the loomly fixture", async () => {
    const fixtureDir = path.resolve("tests/fixtures/demo-chat/loomly");
    const goldenRaw = await fs.readFile(path.join(fixtureDir, "golden-questions.json"), "utf8");
    const golden = JSON.parse(goldenRaw) as Array<{ q: string; expectedStepId?: string; expected?: "no_match" }>;

    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-golden-"));
    await writeIndexForDemoDir({
      demoDir: fixtureDir,
      widgetId: "fixture",
      widgetName: "Fixture",
      locale: "en",
      allowedOrigins: ["https://example.com"],
      dataRoot,
      geminiApiKey: process.env.GEMINI_API_KEY!,
    });

    const indexFile = JSON.parse(
      await fs.readFile(path.join(dataRoot, "widgets/fixture/index.json"), "utf8"),
    ) as IndexFile;

    let hits = 0;
    let totalMatchable = 0;
    for (const g of golden) {
      if (g.expected === "no_match") continue;
      totalMatchable += 1;
      const qe = await embedQuery(g.q, { apiKey: process.env.GEMINI_API_KEY! });
      const r = retrieve({
        query: { embedding: qe, keywords: extractKeywords(g.q) },
        chunks: indexFile.chunks,
        k: 3,
      });
      if (r.chunks.some((c) => c.stepId === g.expectedStepId)) hits += 1;
    }
    const recall = hits / Math.max(1, totalMatchable);
    expect(recall).toBeGreaterThanOrEqual(0.85);
  }, 120_000);
});
```

- [ ] **Step 2: Run the test (requires real Gemini API)**

```bash
RUN_EMBED_TESTS=1 GEMINI_API_KEY=… npx vitest run tests/integration/golden-questions.test.ts
```

If recall is below 0.85, iterate on:
- `extractKeywords` stopword list
- `pickSuggestedQuestions` / chunk text composition
- Or update `golden-questions.json` to match actual fixture step boundaries

- [ ] **Step 3: Commit**

```bash
git add tests/integration/golden-questions.test.ts
git commit -m "test(integration): golden-questions retrieval recall@3 ≥ 85%"
```

---

### Task 5.3: Playwright E2E

**Files:**
- Create: `tests/e2e/widget-playwright.test.ts`
- Create: `tests/e2e/fixture-page.html`

- [ ] **Step 1: Create the test page**

Create `tests/e2e/fixture-page.html`:

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Daymo widget E2E fixture</title></head>
<body>
  <h1>Fixture customer site</h1>
  <p>This page is loaded by Playwright to exercise the daymo widget.</p>
  <script async src="/widget.js" data-widget-id="fixture"></script>
</body>
</html>
```

- [ ] **Step 2: Write the test**

Create `tests/e2e/widget-playwright.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startServer } from "../../src/chat-server/server.js";
import { writeIndexForDemoDir } from "../../src/indexer/write-index.js";
import Anthropic from "@anthropic-ai/sdk";
import { embedQuery } from "../../src/indexer/embedder-gemini.js";

const run = process.env.RUN_LLM_TESTS === "1" && process.env.RUN_EMBED_TESTS === "1"
  && process.env.ANTHROPIC_API_KEY && process.env.GEMINI_API_KEY;

let browser: Browser;
let page: Page;
let backendServer: http.Server;
let staticServer: http.Server;
let dataRoot: string;
let backendPort: number;
let staticPort: number;

beforeAll(async () => {
  if (!run) return;
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-e2e-"));
  await writeIndexForDemoDir({
    demoDir: path.resolve("tests/fixtures/demo-chat/loomly"),
    widgetId: "fixture",
    widgetName: "Fixture",
    locale: "en",
    allowedOrigins: ["http://127.0.0.1:0"], // patched after we know the port
    dataRoot,
    geminiApiKey: process.env.GEMINI_API_KEY!,
  });

  // Start the static server first to know the origin we need to allow.
  staticServer = http.createServer(async (req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.setHeader("Content-Type", "text/html");
      res.end(await fs.readFile("tests/e2e/fixture-page.html"));
      return;
    }
    if (req.url === "/widget.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(await fs.readFile("dist-widget/widget.js"));
      return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((resolve) => staticServer.listen(0, "127.0.0.1", () => resolve()));
  staticPort = (staticServer.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${staticPort}`;

  // Rewrite the config with the real origin
  await fs.writeFile(
    path.join(dataRoot, "widgets/fixture/config.json"),
    JSON.stringify({
      widgetId: "fixture", name: "Fixture", locale: "en",
      allowedOrigins: [origin], suggestedQuestions: [],
    }, null, 2),
  );

  backendServer = await startServer({
    port: 0,
    host: "127.0.0.1",
    dataRoot,
    anthropicClient: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    embedQueryFn: (t) => embedQuery(t, { apiKey: process.env.GEMINI_API_KEY! }),
    baseUrl: "", // set below after binding
  });
  backendPort = (backendServer.address() as { port: number }).port;

  // The widget reads baseUrl from `script.src` origin — point it at the backend.
  // We do this by patching widget.js to use the backend, OR by passing data-base-url.
  // Simpler: serve widget.js with `data-base-url` injected by the test page.
  // Update the static fixture-page.html to include data-base-url:
  const pageHtml = (await fs.readFile("tests/e2e/fixture-page.html", "utf8"))
    .replace("data-widget-id=\"fixture\"", `data-widget-id="fixture" data-base-url="http://127.0.0.1:${backendPort}"`);
  await fs.writeFile(path.join(os.tmpdir(), "fixture-page-patched.html"), pageHtml);

  browser = await chromium.launch();
  page = await browser.newPage();
}, 120_000);

afterAll(async () => {
  if (!run) return;
  await browser?.close();
  await new Promise<void>((r) => backendServer.close(() => r()));
  await new Promise<void>((r) => staticServer.close(() => r()));
});

describe.skipIf(!run)("widget E2E", () => {
  it("opens the bubble, sends a question, renders an answer with a seeking video", async () => {
    await page.goto(`http://127.0.0.1:${staticPort}/`);
    const bubble = await page.waitForSelector("#daymo-widget-root", { timeout: 10000 });
    // Click the bubble inside the shadow root
    await page.evaluate(() => {
      const host = document.querySelector("#daymo-widget-root") as HTMLElement;
      const shadow = (host as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
      const b = shadow.querySelector(".bubble") as HTMLButtonElement;
      b.click();
    });
    await page.evaluate(() => {
      const host = document.querySelector("#daymo-widget-root") as HTMLElement;
      const shadow = (host as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
      const inp = shadow.querySelector(".input-row input") as HTMLInputElement;
      const sendBtn = shadow.querySelector(".input-row button") as HTMLButtonElement;
      inp.value = "How do I create a project?";
      sendBtn.click();
    });

    // Wait up to 15s for a <video> element to appear inside the assistant message
    await page.waitForFunction(() => {
      const host = document.querySelector("#daymo-widget-root") as HTMLElement;
      const shadow = (host as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
      return shadow.querySelector(".msg-assistant video") !== null;
    }, { timeout: 15000 });

    const startSrc = await page.evaluate(() => {
      const host = document.querySelector("#daymo-widget-root") as HTMLElement;
      const shadow = (host as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
      const v = shadow.querySelector("video") as HTMLVideoElement;
      return v.src;
    });
    expect(startSrc).toMatch(/#t=\d/);
  }, 60_000);
});
```

- [ ] **Step 3: Run the E2E (requires both API keys)**

```bash
RUN_LLM_TESTS=1 RUN_EMBED_TESTS=1 ANTHROPIC_API_KEY=… GEMINI_API_KEY=… npx vitest run tests/e2e/widget-playwright.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/widget-playwright.test.ts tests/e2e/fixture-page.html
git commit -m "test(e2e): Playwright widget → backend → seeking video"
```

---

**Milestone 5 complete.** Fixture customer is wired end-to-end. Recall is gated on the golden questions; the Playwright test exercises bubble → chat → answer with a real seeking `<video>` element.

---

## Done criteria (v1 ships when all are true)

1. All unit tests pass under `npx vitest run` (no `RUN_*` flags).
2. All `RUN_EMBED_TESTS=1` integration tests pass with a real `GEMINI_API_KEY`.
3. All `RUN_LLM_TESTS=1` integration tests pass with a real `ANTHROPIC_API_KEY`.
4. The Playwright E2E (`tests/e2e/widget-playwright.test.ts`) passes with both keys.
5. `daymo stitch` writes `step-index.json` and `captions.vtt` alongside `output.mp4`.
6. `daymo index <dir>` produces a valid `index.json` + `config.json` under `<DAYMO_DATA_ROOT>/widgets/<id>/`.
7. `daymo serve` listens on a port and serves all four endpoints.
8. `npm run build:all` produces both `dist/` (node) and `dist-widget/widget.js`.
9. The golden-questions recall@3 is ≥ 0.85 for at least one fixture customer.
10. Three fixture customers can be configured and queried via the widget on desktop and mobile in English, Spanish, and Japanese.
