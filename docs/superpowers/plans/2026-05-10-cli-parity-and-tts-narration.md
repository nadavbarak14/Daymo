# CLI parity & TTS narration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every editor HTTP-API action to the CLI via a shared `core/` module, and add Edge-TTS narration with karaoke-style per-word subtitles driven explicitly by `fx.say()` in the script.

**Architecture:** Refactor in two halves. First half extracts shared logic from `src/editor/` and `src/single-capture.ts` into `src/core/` (capture, stitch, store, rewrite); the editor's HTTP handlers and new CLI commands both call this core. Approval state is removed; stitch instead gates on completeness. Second half adds `src/tts/` (provider interface, Edge TTS impl, content-addressed cache), augments `fx.ts` and `overlay.ts` with `fx.say` / `fx.banner`, makes `controller.ts` pre-synthesize TTS audio + word timings before each scene, records `say` events with offsets, and mixes audio into the final mp4 at stitch time with sidechain ducking against background music.

**Tech Stack:** TypeScript / Node ≥20, Playwright, ffmpeg, vitest, `msedge-tts` (new dep). Existing deps: `cac`, `gray-matter`, `yaml`, `execa`, `chokidar`.

---

## Reference: spec

Source-of-truth design lives at `docs/superpowers/specs/2026-05-10-cli-parity-and-tts-narration-design.md`. Read it first.

## File structure

**New files:**

```
src/
├── core/
│   ├── store.ts            ← was editor/state.ts (simplified, no approval)
│   ├── capture.ts          ← was single-capture.ts (now pre-synthesizes TTS)
│   ├── stitch.ts           ← was editor/stitch.ts + new audio-mix logic
│   └── rewrite.ts          ← was editor/script-rewrite.ts
├── tts/
│   ├── provider.ts         ← TtsProvider interface + types
│   ├── edge.ts             ← Edge TTS impl using msedge-tts
│   ├── cache.ts            ← content-addressed cache wrapper
│   ├── scan.ts             ← AST scan: extract fx.say(...) literals from playwright code
│   └── mock.ts             ← deterministic mock provider for tests
├── commands/
│   ├── capture.ts          ← new
│   ├── stitch.ts           ← new
│   ├── state.ts            ← new
│   ├── set-prose.ts        ← new
│   └── migrate-prose.ts    ← new
tests/unit/
├── core-store.test.ts      ← was state-reducer.test.ts (rewritten)
├── tts-cache.test.ts
├── tts-scan.test.ts
├── tts-edge.test.ts        ← uses fixtures
├── stitch-audio-args.test.ts
├── migrate-prose.test.ts
└── overlay-say.test.ts     ← jsdom-based, exercises subtitle DOM
tests/integration/
├── cli-capture.test.ts
├── cli-stitch.test.ts
├── cli-state.test.ts
├── cli-set-prose.test.ts
├── cli-parity.test.ts      ← editor capture vs CLI capture: byte-identical
└── tts-end-to-end.test.ts  ← real ffmpeg, mock TTS, asserts audio track
```

**Modified files:**

```
src/
├── cli.ts                 ← register new subcommands
├── parser.ts              ← parse `tts:` frontmatter
├── types.ts               ← add Frontmatter.tts; RunnerEvent "say"; DemoFx say/banner
├── fx.ts                  ← add say/banner/hideBanner
├── overlay.ts             ← add karaoke subtitle bar + banner ops
├── controller.ts          ← pre-synthesis pass; sayTable injection; remove auto-prose-as-banner
├── runner.ts              ← drop auto-prose; pass TTS provider into controller
├── single-capture.ts      ← DELETE (moved to core/capture.ts)
├── editor/
│   ├── state.ts           ← becomes a thin re-export of core/store.ts
│   ├── stitch.ts          ← thin wrapper around core/stitch.ts
│   ├── script-rewrite.ts  ← thin wrapper around core/rewrite.ts
│   ├── capture.ts         ← unchanged (queue stays); calls core/capture.ts
│   ├── api.ts             ← drop handleApprove + ApproveCtx
│   ├── server.ts          ← drop /api/approve route, drop allApproved gate
│   ├── types.ts           ← SceneState collapses to "pending"|"captured"
│   └── index.ts           ← drop `approve` wiring
└── editor-ui/src/
    ├── store.ts           ← drop allApproved
    ├── lib/types.ts       ← SceneState = "pending"|"captured"
    ├── lib/api.ts         ← drop approve()
    ├── components/Rail.tsx, ReviewBar.tsx, StitchBar.tsx, etc.
                           ← remove approve buttons
README.md                  ← document new CLI + fx.say + fx.banner
package.json               ← add msedge-tts dep
```

**Deleted:** `src/single-capture.ts` (moved). `src/editor/state.ts`'s `approve` action and `allApproved` field.

## Phases

- **A.** core/ extraction & approval removal (refactor only — no UX change)
- **B.** new CLI commands (no TTS yet)
- **C.** TTS subsystem (provider, cache, scanner)
- **D.** fx.say / fx.banner runtime + overlay
- **E.** stitch-time audio mixing + sidechain ducking
- **F.** migrate-prose helper + repo demo migration
- **G.** CLI/editor parity test + final docs

Each task: write failing test → run it → implement → run all unit tests → commit.

---

## Phase A — core/ extraction & approval removal

### Task A1: Create core/store.ts with simplified reducer

**Files:**
- Create: `src/core/store.ts`
- Test: `tests/unit/core-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/core-store.test.ts
import { describe, it, expect } from "vitest";
import { initialState, reduce } from "../../src/core/store.js";

const scenes = [
  { sourceLine: 5, title: "S1", prose: "p1", overlays: [] },
  { sourceLine: 9, title: "S2", prose: "p2", overlays: [] },
] as any;

describe("core store reducer", () => {
  it("starts every scene as pending", () => {
    const s = initialState({ demoFile: "/p/d.demo", scenes });
    expect(s.scenes.every((r) => r.state === "pending")).toBe(true);
    expect((s as any).allApproved).toBeUndefined();
  });

  it("capture-done marks captured + stores webm path", () => {
    let s = initialState({ demoFile: "/p/d.demo", scenes });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm", eventsPath: "/cap/scene-001.events.json" });
    expect(s.scenes[0].state).toBe("captured");
    expect(s.scenes[0].webmPath).toBe("/cap/scene-001.webm");
  });

  it("scene-changed drops captured back to pending", () => {
    let s = initialState({ demoFile: "/p/d.demo", scenes });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/x.webm" });
    s = reduce(s, { type: "scene-changed", sceneIndex: 0 });
    expect(s.scenes[0].state).toBe("pending");
    expect(s.scenes[0].webmPath).toBeUndefined();
  });

  it("rejects approve action (removed)", () => {
    let s = initialState({ demoFile: "/p/d.demo", scenes });
    expect(() => reduce(s, { type: "approve" } as any)).toThrow(/unknown action/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/core-store.test.ts`
Expected: FAIL — module `../../src/core/store.js` not found.

- [ ] **Step 3: Create src/core/store.ts**

```ts
// src/core/store.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { Scene } from "../types.js";

export type SceneState = "pending" | "captured";

export interface SceneRow {
  sourceLine: number;
  title: string;
  prose: string;
  overlays: Scene["overlays"];
  state: SceneState;
  webmPath?: string;
  eventsPath?: string;
  capturedAt?: number;
  errorMessage?: string;
}

export interface EditorState {
  demoFile: string;
  scenes: SceneRow[];
}

export type StateAction =
  | { type: "capture-start"; sceneIndex: number }
  | { type: "capture-done"; sceneIndex: number; webmPath: string; eventsPath?: string }
  | { type: "capture-error"; sceneIndex: number; message: string }
  | { type: "scene-changed"; sceneIndex: number }
  | { type: "scenes-replaced"; scenes: Scene[] };

export function initialState(opts: { demoFile: string; scenes: Scene[] }): EditorState {
  return {
    demoFile: opts.demoFile,
    scenes: opts.scenes.map(toRow),
  };
}

function toRow(s: Scene): SceneRow {
  return { sourceLine: s.sourceLine, title: s.title, prose: s.prose, overlays: s.overlays, state: "pending" };
}

function withRow(s: EditorState, i: number, patch: Partial<SceneRow>): EditorState {
  const scenes = s.scenes.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
  return { ...s, scenes };
}

export function reduce(s: EditorState, a: StateAction): EditorState {
  switch (a.type) {
    case "capture-start":
      return withRow(s, a.sceneIndex, { errorMessage: undefined });
    case "capture-done":
      return withRow(s, a.sceneIndex, {
        state: "captured",
        webmPath: a.webmPath,
        eventsPath: a.eventsPath,
        capturedAt: Date.now(),
        errorMessage: undefined,
      });
    case "capture-error":
      return withRow(s, a.sceneIndex, { errorMessage: a.message });
    case "scene-changed":
      return withRow(s, a.sceneIndex, { state: "pending", webmPath: undefined, eventsPath: undefined, capturedAt: undefined });
    case "scenes-replaced":
      return { ...s, scenes: a.scenes.map(toRow) };
    default:
      throw new Error(`unknown action: ${(a as any).type}`);
  }
}

interface Persisted {
  version: 1 | 2;
  scenes: Array<{
    sourceLine: number;
    state: SceneState | "approved"; // "approved" tolerated for backcompat
    webmPath?: string;
    eventsPath?: string;
    capturedAt?: number;
  }>;
}

export async function saveState(file: string, s: EditorState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data: Persisted = {
    version: 2,
    scenes: s.scenes.map((r) => ({
      sourceLine: r.sourceLine,
      state: r.state,
      webmPath: r.webmPath,
      eventsPath: r.eventsPath,
      capturedAt: r.capturedAt,
    })),
  };
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

export async function loadState(file: string, scenes: Scene[], demoFile: string): Promise<EditorState> {
  let raw: string;
  try { raw = await fs.readFile(file, "utf8"); }
  catch { return initialState({ demoFile, scenes }); }
  const data = JSON.parse(raw) as Persisted;
  let s = initialState({ demoFile, scenes });
  for (let i = 0; i < s.scenes.length; i++) {
    const persisted = data.scenes.find((p) => p.sourceLine === s.scenes[i].sourceLine);
    if (!persisted) continue;
    // Coerce legacy "approved" → "captured"
    const isCaptured = persisted.state === "captured" || persisted.state === "approved";
    if (isCaptured && persisted.webmPath) {
      s = reduce(s, {
        type: "capture-done",
        sceneIndex: i,
        webmPath: persisted.webmPath,
        eventsPath: persisted.eventsPath,
      });
    }
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/core-store.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts tests/unit/core-store.test.ts
git commit -m "feat(core): introduce core/store.ts with simplified state reducer"
```

---

### Task A2: Backcompat test for legacy "approved" state.json

**Files:**
- Modify: `tests/unit/core-store.test.ts`
- Reference: `src/core/store.ts`

- [ ] **Step 1: Add a test case**

Append to `tests/unit/core-store.test.ts`:

```ts
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { saveState, loadState } from "../../src/core/store.js";

describe("core store persistence", () => {
  it("coerces legacy state: 'approved' to 'captured' on load", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-store-"));
    const file = path.join(dir, "state.json");
    await fs.writeFile(file, JSON.stringify({
      version: 1,
      scenes: [
        { sourceLine: 5, state: "approved", webmPath: "/cap/scene-001.webm" },
        { sourceLine: 9, state: "captured", webmPath: "/cap/scene-002.webm" },
      ],
    }));
    const s = await loadState(file, scenes, "/p/d.demo");
    expect(s.scenes[0].state).toBe("captured");
    expect(s.scenes[1].state).toBe("captured");
  });

  it("round-trips current state with version 2", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-store-"));
    const file = path.join(dir, "state.json");
    let s = initialState({ demoFile: "/p/d.demo", scenes });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/x.webm" });
    await saveState(file, s);
    const loaded = await loadState(file, scenes, "/p/d.demo");
    expect(loaded.scenes[0].state).toBe("captured");
    expect(loaded.scenes[0].webmPath).toBe("/x.webm");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/core-store.test.ts`
Expected: PASS — both new cases (loadState already handles backcompat).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/core-store.test.ts
git commit -m "test(core): cover legacy approved-state coercion + round-trip"
```

---

### Task A3: Create core/capture.ts (move from src/single-capture.ts)

**Files:**
- Create: `src/core/capture.ts`
- Modify: `src/single-capture.ts` → re-export wrapper (kept for one task to avoid breaking everything; deleted in Task A8)
- Test: `tests/integration/single-capture.test.ts` (already exists; verify still passes after move)

- [ ] **Step 1: Read the existing test**

Run: `cat tests/integration/single-capture.test.ts`
Note current import: `from "../../src/single-capture.js"`. Will not change yet (Task A8).

- [ ] **Step 2: Create src/core/capture.ts as exact copy**

Copy the body of `src/single-capture.ts` to `src/core/capture.ts`, with imports updated for the new path:

```ts
// src/core/capture.ts
import path from "node:path";
import fs from "node:fs/promises";
import { Controller } from "../controller.js";
import type { DemoAst } from "../types.js";

export interface CaptureSingleSceneOpts {
  capturesDir: string;
  demoFile: string;
}

export interface CaptureSingleSceneResult {
  webm: string;
  events: string;
}

export async function captureSingleScene(
  ast: DemoAst,
  sceneIndex: number,
  opts: CaptureSingleSceneOpts,
): Promise<CaptureSingleSceneResult> {
  if (sceneIndex < 0 || sceneIndex >= ast.scenes.length) {
    throw new Error(`scene index ${sceneIndex} out of range`);
  }
  const scene = ast.scenes[sceneIndex];
  await fs.mkdir(opts.capturesDir, { recursive: true });

  const baseDir = path.dirname(path.resolve(opts.demoFile));
  const tmpArtifacts = await fs.mkdtemp(path.join(opts.capturesDir, `.tmp-${sceneIndex}-`));

  const ctrl = await Controller.start({
    url: ast.frontmatter.url,
    viewport: ast.frontmatter.viewport,
    mocks: ast.frontmatter.mocks,
    storageStatePath: ast.frontmatter.auth?.storageState
      ? path.resolve(baseDir, ast.frontmatter.auth.storageState)
      : undefined,
    artifactsDir: tmpArtifacts,
  });
  try {
    await ctrl.runScene(scene);
  } finally {
    await ctrl.stop();
  }

  const tmpWebm = path.join(tmpArtifacts, "raw_page.webm");
  const tmpEvents = path.join(tmpArtifacts, "events.json");
  const tag = String(sceneIndex + 1).padStart(3, "0");
  const finalWebm = path.join(opts.capturesDir, `scene-${tag}.webm`);
  const finalEvents = path.join(opts.capturesDir, `scene-${tag}.events.json`);

  await fs.rename(tmpWebm, finalWebm);
  await fs.rename(tmpEvents, finalEvents);
  await fs.rm(tmpArtifacts, { recursive: true, force: true });

  return { webm: finalWebm, events: finalEvents };
}
```

- [ ] **Step 3: Make src/single-capture.ts a re-export shim**

Replace the whole body with:

```ts
// src/single-capture.ts — DEPRECATED: re-export of core/capture.ts. Will be removed in Task A8.
export * from "./core/capture.js";
```

- [ ] **Step 4: Run all unit tests**

Run: `npx vitest run`
Expected: PASS — no behavior change. Integration test for single-capture skipped if it requires Playwright; that's fine.

- [ ] **Step 5: Commit**

```bash
git add src/core/capture.ts src/single-capture.ts
git commit -m "refactor(core): move single-capture to core/capture (shim left behind)"
```

---

### Task A4: Create core/stitch.ts (move from src/editor/stitch.ts)

**Files:**
- Create: `src/core/stitch.ts`
- Create: `src/core/concat.ts` (move from `src/editor/concat.ts`)
- Modify: `src/editor/stitch.ts`, `src/editor/concat.ts` → re-export shims
- Test: existing `tests/unit/concat-args.test.ts` should still pass

- [ ] **Step 1: Verify existing tests pass before move**

Run: `npx vitest run tests/unit/concat-args.test.ts`
Expected: PASS.

- [ ] **Step 2: Move concat.ts**

Create `src/core/concat.ts` as exact copy of `src/editor/concat.ts`. Replace `src/editor/concat.ts` body with:

```ts
export * from "../core/concat.js";
```

- [ ] **Step 3: Move stitch.ts**

Create `src/core/stitch.ts`:

```ts
// src/core/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { buildConcatList, buildStitchArgs } from "./concat.js";

export interface StitchOpts {
  scenePaths: string[];
  music: string | null;
  output: string;
  workDir: string;
  musicVolume?: number;
  onLine?: (line: string) => void;
}

export async function stitch(opts: StitchOpts): Promise<string> {
  const listFile = path.join(opts.workDir, "concat-list.txt");
  await fs.writeFile(listFile, buildConcatList(opts.scenePaths));
  const args = buildStitchArgs({
    listFile,
    music: opts.music,
    output: opts.output,
    musicVolume: opts.musicVolume,
  });
  const proc = execa("ffmpeg", args);
  if (opts.onLine && proc.stderr) {
    proc.stderr.setEncoding("utf8");
    let buf = "";
    proc.stderr.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) opts.onLine!(line);
    });
  }
  await proc;
  return opts.output;
}
```

Replace `src/editor/stitch.ts` body with:

```ts
export * from "../core/stitch.js";
```

- [ ] **Step 4: Update tests**

In `tests/unit/concat-args.test.ts`, change the import path:

```ts
import { buildConcatList, buildStitchArgs } from "../../src/core/concat.js";
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/stitch.ts src/core/concat.ts src/editor/stitch.ts src/editor/concat.ts tests/unit/concat-args.test.ts
git commit -m "refactor(core): move stitch + concat to core (editor shims kept)"
```

---

### Task A5: Create core/rewrite.ts (move from src/editor/script-rewrite.ts)

**Files:**
- Create: `src/core/rewrite.ts`
- Modify: `src/editor/script-rewrite.ts` → re-export shim
- Modify: `tests/unit/script-rewrite.test.ts` → import path

- [ ] **Step 1: Move file**

Create `src/core/rewrite.ts` as exact copy of `src/editor/script-rewrite.ts`. Replace `src/editor/script-rewrite.ts` body with:

```ts
export * from "../core/rewrite.js";
```

- [ ] **Step 2: Update test import**

In `tests/unit/script-rewrite.test.ts`, change the import to `../../src/core/rewrite.js`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/script-rewrite.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/rewrite.ts src/editor/script-rewrite.ts tests/unit/script-rewrite.test.ts
git commit -m "refactor(core): move script-rewrite to core/rewrite"
```

---

### Task A6: Switch editor/state.ts and editor/types.ts to re-export core/store.ts

**Files:**
- Modify: `src/editor/state.ts`
- Modify: `src/editor/types.ts`
- Modify: `tests/unit/state-reducer.test.ts` → DELETE (replaced by `tests/unit/core-store.test.ts`)
- Modify: `tests/integration/state-persist.test.ts` → update imports
- Modify: `src/editor/index.ts` → use core types
- Modify: `src/editor/api.ts` → drop ApproveCtx, handleApprove, allApproved gate
- Modify: `src/editor/server.ts` → drop /api/approve route, drop allApproved gate
- Modify: `src/editor/capture.ts` → import from core
- Modify: `src/editor/sse.ts` → unchanged
- Modify: `editor-ui/src/lib/types.ts`, `editor-ui/src/store.ts`, `editor-ui/src/lib/api.ts` → drop allApproved, approve()

- [ ] **Step 1: Update src/editor/types.ts to re-export**

Replace body with:

```ts
// src/editor/types.ts — DEPRECATED: re-exports of core/store types.
export type { SceneState, SceneRow, EditorState, StateAction } from "../core/store.js";
```

- [ ] **Step 2: Update src/editor/state.ts to re-export**

Replace body with:

```ts
// src/editor/state.ts — DEPRECATED: re-exports of core/store.
export { initialState, reduce, saveState, loadState } from "../core/store.js";
export type { SceneState, SceneRow, EditorState, StateAction } from "../core/store.js";
```

- [ ] **Step 3: Drop approve from src/editor/api.ts**

Remove `ApproveCtx` interface and `handleApprove` function entirely. Remove `allApproved: () => boolean` from `StitchCtx` and the `if (!ctx.allApproved())` gate in `handleStitch` — replace it with a completeness check:

```ts
export interface StitchCtx extends ApiCtx {
  stitchNow(): Promise<string>;
  pendingScenes(): number[]; // 0-indexed scene indices that are still "pending"
}

export async function handleStitch(ctx: StitchCtx, res: ServerResponse): Promise<void> {
  const pending = ctx.pendingScenes();
  if (pending.length > 0) {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `scenes not captured: ${pending.map((i) => i + 1).join(", ")}` }));
    return;
  }
  try {
    const output = await ctx.stitchNow();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ output }));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
```

- [ ] **Step 4: Drop /api/approve from src/editor/server.ts**

Remove the `am` route (lines matching `^/api/approve/(\d+)$`). Remove `approve` from `ServerOpts` interface. Update `handleStitch` call site:

```ts
return handleStitch(
  { ...ctx, stitchNow: opts.stitchNow, pendingScenes: () => opts.getState().scenes.flatMap((r, i) => r.state === "pending" ? [i] : []) },
  res,
);
```

- [ ] **Step 5: Drop approve from src/editor/index.ts**

Remove the `approve` const declaration and the `approve` field passed to `startServer`. Remove any references to `state.allApproved`.

- [ ] **Step 6: Drop allApproved from editor-ui**

In `editor-ui/src/lib/types.ts`, change `SceneState` to `"pending" | "captured"` (drop `"approved"`). Remove `allApproved` field from `EditorState`.

In `editor-ui/src/store.ts`, in `patchScene`, drop the `allApproved` recalc:

```ts
patchScene: (i, patch) =>
  set((u) => {
    if (!u.state) return u;
    const scenes = u.state.scenes.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
    return { state: { ...u.state, scenes } };
  }),
```

In `editor-ui/src/lib/api.ts`, remove `approve(sceneIndex, approved)` function and any references.

In components (`Rail.tsx`, `ReviewBar.tsx`, `StitchBar.tsx`, etc.), remove all approve/unapprove buttons and "approved" UI state. Search the codebase: `grep -rn "approved\|allApproved\|approve(" editor-ui/src` and remove each hit.

- [ ] **Step 7: Delete obsolete test, update other tests**

Delete `tests/unit/state-reducer.test.ts` (replaced by `tests/unit/core-store.test.ts` from A1+A2).

Update `tests/integration/state-persist.test.ts` imports to `../../src/core/store.js`. Remove any test cases that exercise `approve` action — coerce them to `capture-done` only.

- [ ] **Step 8: Run all tests + build editor-ui**

Run: `npx vitest run && cd editor-ui && npm run build && cd ..`
Expected: all PASS, editor-ui builds.

- [ ] **Step 9: Commit**

```bash
git add src/editor tests editor-ui
git commit -m "refactor(editor): drop approval — store + API + UI"
```

---

### Task A7: Make editor capture pull DemoAst with the new tts frontmatter (defensive)

This is a stub task — the editor capture already passes ast through `getAst()`. No code change here, but we run the editor tests to confirm nothing else broke.

- [ ] **Step 1: Run integration tests**

Run: `npx vitest run tests/integration/`
Expected: PASS.

- [ ] **Step 2: No commit needed if no changes**

---

### Task A8: Delete the single-capture.ts shim

**Files:**
- Modify: `src/single-capture.ts` → DELETE
- Search and update any remaining `import .* single-capture` references

- [ ] **Step 1: Find references**

Run: `grep -rn "single-capture" src/ tests/ editor-ui/`
Update any to import from `../../src/core/capture.js` or the appropriate relative path. Common hits: `src/editor/capture.ts`.

- [ ] **Step 2: Update src/editor/capture.ts**

```ts
import { captureSingleScene } from "../core/capture.js";
// rest unchanged
```

- [ ] **Step 3: Delete the shim**

```bash
git rm src/single-capture.ts
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete single-capture.ts shim"
```

---

### Task A9: Update src/runner.ts to drop auto-prose-as-banner

**Files:**
- Modify: `src/runner.ts`
- Modify: `src/controller.ts` → remove `if (scene.prose.trim()) showCaption(...)` block

- [ ] **Step 1: Write a regression test**

Create `tests/unit/controller-no-prose-banner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { OVERLAY_INIT_SCRIPT } from "../../src/overlay.js";
import * as controller from "../../src/controller.js";

describe("controller (post-banner-removal)", () => {
  it("Controller source no longer references showCaption directly", () => {
    // Read the controller source file via fs to assert.
    const src = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../src/controller.ts"), "utf8");
    expect(src).not.toMatch(/showCaption\s*\(/);
    expect(src).not.toMatch(/hideCaption\s*\(/);
  });

  it("OVERLAY_INIT_SCRIPT still defines showCaption (for fx.banner backward implementation)", () => {
    expect(OVERLAY_INIT_SCRIPT).toMatch(/showCaption/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/controller-no-prose-banner.test.ts`
Expected: FAIL — source still contains `showCaption(`.

- [ ] **Step 3: Edit src/controller.ts**

In `runScene`, remove the entire `if (scene.prose.trim()) { ... }` block and the trailing `await this.page.evaluate(() => (window as any).__daymo.hideCaption());` line.

The new `runScene` body:

```ts
async runScene(scene: Scene): Promise<void> {
  this.events.push({
    kind: "scene_start",
    t: this.now(),
    index: scene.sourceLine,
    title: scene.title,
    prose: scene.prose,
  });
  try {
    if (scene.playwrightCode) {
      const fx = createFx(this.page, this.events, () => this.now());
      const console = {
        log: (...args: unknown[]) => this.events.push({ kind: "log", t: this.now(), level: "log", args }),
        warn: (...args: unknown[]) => this.events.push({ kind: "log", t: this.now(), level: "warn", args }),
        error: (...args: unknown[]) => this.events.push({ kind: "log", t: this.now(), level: "error", args }),
      };
      await runSceneBlock(
        { code: scene.playwrightCode.code, sourceLine: scene.playwrightCode.sourceLine, sceneTitle: scene.title },
        { page: this.page, fx, console },
      );
    }
    for (const directive of scene.overlays) {
      // ... unchanged ...
    }
    this.events.push({ kind: "scene_end", t: this.now(), index: scene.sourceLine });
  } catch (e) {
    this.events.push({ kind: "error", t: this.now(), message: (e as Error).message, sceneIndex: scene.sourceLine });
    throw e;
  }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/controller-no-prose-banner.test.ts`
Expected: PASS.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS — note: tests that depended on the prose banner appearing during capture should be marked `skip` and revisited in Phase F.

- [ ] **Step 6: Commit**

```bash
git add src/controller.ts tests/unit/controller-no-prose-banner.test.ts
git commit -m "refactor(controller): drop auto-prose-as-banner (replaced by fx.banner)"
```

---

## Phase B — new CLI commands (no TTS yet)

### Task B1: Create commands/state.ts and register `daymo state`

**Files:**
- Create: `src/commands/state.ts`
- Modify: `src/cli.ts`
- Test: `tests/integration/cli-state.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/cli-state.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

const tinyDemo = `---
title: tiny
url: about:blank
---

# Scene one

Hello world.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;

async function tmpDemo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-state-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, tinyDemo);
  return file;
}

describe("daymo state", () => {
  it("prints scene table with all pending when no .daymo/", async () => {
    const file = await tmpDemo();
    const { stdout } = await execa("node", [cliBin, "state", file]);
    expect(stdout).toMatch(/Scene one/);
    expect(stdout).toMatch(/pending/);
  });

  it("--json emits machine-readable state", async () => {
    const file = await tmpDemo();
    const { stdout } = await execa("node", [cliBin, "state", file, "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.scenes[0].state).toBe("pending");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc && npx vitest run tests/integration/cli-state.test.ts`
Expected: FAIL — `state` is not a registered command.

- [ ] **Step 3: Create src/commands/state.ts**

```ts
// src/commands/state.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState } from "../core/store.js";

export interface StateFlags {
  json?: boolean;
}

export async function stateCommand(file: string, flags: StateFlags): Promise<void> {
  const demoFile = path.resolve(file);
  const ast = parse(await fs.readFile(demoFile, "utf8"));
  const stateFile = path.join(path.dirname(demoFile), ".daymo", "state.json");
  const state = await loadState(stateFile, ast.scenes, demoFile);

  if (flags.json) {
    process.stdout.write(JSON.stringify(state, null, 2) + "\n");
    return;
  }

  const lines: string[] = [];
  lines.push(`# ${ast.frontmatter.title}`);
  lines.push("");
  for (let i = 0; i < state.scenes.length; i++) {
    const r = state.scenes[i];
    const tag = String(i + 1).padStart(2, " ");
    const status = r.state.padEnd(8, " ");
    lines.push(`  ${tag}  ${status}  ${r.title}`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}
```

- [ ] **Step 4: Register in src/cli.ts**

Add the import and command registration:

```ts
import { stateCommand } from "./commands/state.js";
// ...
cli.command("state <file>", "Print scene state table")
  .option("--json", "Emit raw JSON state")
  .action((file: string, flags: { json: boolean }) =>
    stateCommand(file, { json: flags.json }),
  );
```

- [ ] **Step 5: Build and run test**

Run: `npx tsc && npx vitest run tests/integration/cli-state.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/state.ts src/cli.ts tests/integration/cli-state.test.ts
git commit -m "feat(cli): add daymo state command"
```

---

### Task B2: Create commands/capture.ts and register `daymo capture`

**Files:**
- Create: `src/commands/capture.ts`
- Modify: `src/cli.ts`
- Test: `tests/integration/cli-capture.test.ts`

This command supports `--scene N` (1-indexed) and `--all`. It uses `core/capture.ts` and persists `.daymo/state.json`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/cli-capture.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

const tinyDemo = `---
title: tiny
url: about:blank
viewport: { width: 200, height: 200 }
---

# Scene one

Hello.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`

---

# Scene two

World.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;

async function tmpDemo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-capture-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, tinyDemo);
  return file;
}

describe("daymo capture", () => {
  it("--scene N captures one scene and updates state.json", async () => {
    const file = await tmpDemo();
    const { stdout, exitCode } = await execa("node", [cliBin, "capture", file, "--scene", "1"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/scene-001\.webm/);
    const state = JSON.parse(await fs.readFile(path.join(path.dirname(file), ".daymo/state.json"), "utf8"));
    expect(state.scenes[0].state).toBe("captured");
    expect(state.scenes[1].state).toBe("pending");
  }, 60_000);

  it("--all captures every scene", async () => {
    const file = await tmpDemo();
    const { exitCode } = await execa("node", [cliBin, "capture", file, "--all"]);
    expect(exitCode).toBe(0);
    const state = JSON.parse(await fs.readFile(path.join(path.dirname(file), ".daymo/state.json"), "utf8"));
    expect(state.scenes.every((r: any) => r.state === "captured")).toBe(true);
  }, 120_000);

  it("--scene out of range exits non-zero", async () => {
    const file = await tmpDemo();
    const result = await execa("node", [cliBin, "capture", file, "--scene", "99"], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/out of range|99/);
  });

  it("--scene and --all are mutually exclusive", async () => {
    const file = await tmpDemo();
    const result = await execa("node", [cliBin, "capture", file, "--scene", "1", "--all"], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--scene.*--all|--all.*--scene/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc && npx vitest run tests/integration/cli-capture.test.ts`
Expected: FAIL — `capture` not registered.

- [ ] **Step 3: Create src/commands/capture.ts**

```ts
// src/commands/capture.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { captureSingleScene } from "../core/capture.js";
import { loadState, reduce, saveState } from "../core/store.js";

export interface CaptureFlags {
  scene?: number; // 1-indexed
  all?: boolean;
}

export async function captureCommand(file: string, flags: CaptureFlags): Promise<void> {
  if (flags.scene !== undefined && flags.all) {
    throw new Error("--scene and --all are mutually exclusive");
  }
  if (flags.scene === undefined && !flags.all) {
    throw new Error("must specify --scene N or --all");
  }

  const demoFile = path.resolve(file);
  const dotDir = path.join(path.dirname(demoFile), ".daymo");
  const capturesDir = path.join(dotDir, "captures");
  const stateFile = path.join(dotDir, "state.json");
  const ast = parse(await fs.readFile(demoFile, "utf8"));

  let state = await loadState(stateFile, ast.scenes, demoFile);

  const targets: number[] = flags.all
    ? ast.scenes.map((_, i) => i)
    : [(flags.scene as number) - 1];

  for (const i of targets) {
    if (i < 0 || i >= ast.scenes.length) {
      throw new Error(`scene ${i + 1} out of range (have ${ast.scenes.length})`);
    }
    const result = await captureSingleScene(ast, i, { capturesDir, demoFile });
    state = reduce(state, {
      type: "capture-done",
      sceneIndex: i,
      webmPath: result.webm,
      eventsPath: result.events,
    });
    await saveState(stateFile, state);
    process.stdout.write(`captured scene ${i + 1}: ${result.webm}\n`);
  }
}
```

- [ ] **Step 4: Register in src/cli.ts**

```ts
import { captureCommand } from "./commands/capture.js";
// ...
cli.command("capture <file>", "Capture one scene (--scene N) or all scenes (--all)")
  .option("--scene <n>", "Scene index, 1-based")
  .option("--all", "Capture every scene")
  .action((file: string, flags: { scene?: string; all?: boolean }) =>
    captureCommand(file, {
      scene: flags.scene !== undefined ? Number(flags.scene) : undefined,
      all: !!flags.all,
    }),
  );
```

- [ ] **Step 5: Build and run test**

Run: `npx tsc && npx vitest run tests/integration/cli-capture.test.ts`
Expected: PASS — all 4 cases. Note: the "--all captures every scene" test is slow (~60s); it spawns Playwright twice.

- [ ] **Step 6: Commit**

```bash
git add src/commands/capture.ts src/cli.ts tests/integration/cli-capture.test.ts
git commit -m "feat(cli): add daymo capture --scene N | --all"
```

---

### Task B3: Create commands/stitch.ts and register `daymo stitch`

**Files:**
- Create: `src/commands/stitch.ts`
- Modify: `src/cli.ts`
- Test: `tests/integration/cli-stitch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/cli-stitch.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

async function tmpDemoWithCaptures(): Promise<{ file: string; dotDir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-stitch-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, `---
title: tiny
url: about:blank
viewport: { width: 200, height: 200 }
---

# One

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`);
  // Pre-capture
  await execa("node", [cliBin, "capture", file, "--all"]);
  return { file, dotDir: path.join(dir, ".daymo") };
}

describe("daymo stitch", () => {
  it("composes captured scenes into output.mp4", async () => {
    const { file } = await tmpDemoWithCaptures();
    const { stdout, exitCode } = await execa("node", [cliBin, "stitch", file]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/output\.mp4/);
    const out = path.join(path.dirname(file), "output.mp4");
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  }, 60_000);

  it("errors when scenes are still pending", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-stitch-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, `---
title: tiny
url: about:blank
---

# One
\`\`\`playwright
await fx.pause(0.1);
\`\`\`

---

# Two
\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`);
    // Capture only scene 1.
    await execa("node", [cliBin, "capture", file, "--scene", "1"]);
    const result = await execa("node", [cliBin, "stitch", file], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/scenes not captured.*2/);
  }, 60_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc && npx vitest run tests/integration/cli-stitch.test.ts`
Expected: FAIL — `stitch` not registered.

- [ ] **Step 3: Create src/commands/stitch.ts**

```ts
// src/commands/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState } from "../core/store.js";
import { stitch } from "../core/stitch.js";

export async function stitchCommand(file: string): Promise<void> {
  const demoFile = path.resolve(file);
  const baseDir = path.dirname(demoFile);
  const dotDir = path.join(baseDir, ".daymo");
  const stateFile = path.join(dotDir, "state.json");

  const ast = parse(await fs.readFile(demoFile, "utf8"));
  const state = await loadState(stateFile, ast.scenes, demoFile);

  const pending: number[] = state.scenes.flatMap((r, i) => r.state === "pending" ? [i + 1] : []);
  if (pending.length > 0) {
    throw new Error(`scenes not captured: ${pending.join(", ")} — run: daymo capture <file> --all`);
  }

  const scenePaths = state.scenes.map((r) => r.webmPath!);
  const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  const output = path.join(baseDir, "output.mp4");

  await stitch({
    scenePaths,
    music,
    output,
    workDir: dotDir,
    onLine: () => {},
  });
  process.stdout.write(`${output}\n`);
}
```

- [ ] **Step 4: Register in src/cli.ts**

```ts
import { stitchCommand } from "./commands/stitch.js";
// ...
cli.command("stitch <file>", "Compose all captured scenes into output.mp4")
  .action((file: string) => stitchCommand(file));
```

- [ ] **Step 5: Build and run test**

Run: `npx tsc && npx vitest run tests/integration/cli-stitch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/stitch.ts src/cli.ts tests/integration/cli-stitch.test.ts
git commit -m "feat(cli): add daymo stitch (errors on pending scenes)"
```

---

### Task B4: Create commands/set-prose.ts and register `daymo set-prose`

**Files:**
- Create: `src/commands/set-prose.ts`
- Modify: `src/cli.ts`
- Test: `tests/integration/cli-set-prose.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/cli-set-prose.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

describe("daymo set-prose", () => {
  it("rewrites scene prose in place", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-prose-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, `---
title: tiny
url: about:blank
---

# One

Old prose.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`);
    const { exitCode } = await execa("node", [cliBin, "set-prose", file, "--scene", "1", "--text", "New prose."]);
    expect(exitCode).toBe(0);
    const after = await fs.readFile(file, "utf8");
    expect(after).toMatch(/New prose\./);
    expect(after).not.toMatch(/Old prose\./);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc && npx vitest run tests/integration/cli-set-prose.test.ts`
Expected: FAIL — `set-prose` not registered.

- [ ] **Step 3: Create src/commands/set-prose.ts**

```ts
// src/commands/set-prose.ts
import path from "node:path";
import fs from "node:fs/promises";
import { rewriteSceneProse } from "../core/rewrite.js";

export interface SetProseFlags {
  scene: number; // 1-indexed
  text: string;
}

export async function setProseCommand(file: string, flags: SetProseFlags): Promise<void> {
  const demoFile = path.resolve(file);
  const src = await fs.readFile(demoFile, "utf8");
  const next = rewriteSceneProse(src, flags.scene - 1, flags.text);
  await fs.writeFile(demoFile, next);
  process.stdout.write(`${demoFile}\n`);
}
```

- [ ] **Step 4: Register in src/cli.ts**

```ts
import { setProseCommand } from "./commands/set-prose.js";
// ...
cli.command("set-prose <file>", "Rewrite a scene's prose markdown")
  .option("--scene <n>", "Scene index, 1-based")
  .option("--text <txt>", "New prose")
  .action((file: string, flags: { scene: string; text: string }) => {
    if (!flags.scene || flags.text === undefined) throw new Error("--scene and --text are required");
    return setProseCommand(file, { scene: Number(flags.scene), text: flags.text });
  });
```

- [ ] **Step 5: Build and run test**

Run: `npx tsc && npx vitest run tests/integration/cli-set-prose.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/set-prose.ts src/cli.ts tests/integration/cli-set-prose.test.ts
git commit -m "feat(cli): add daymo set-prose"
```

---

## Phase C — TTS subsystem

### Task C1: Add msedge-tts dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install msedge-tts@^1.3.5`

- [ ] **Step 2: Verify the install**

Run: `node -e "require('msedge-tts'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add msedge-tts dependency"
```

---

### Task C2: Define TtsProvider interface

**Files:**
- Create: `src/tts/provider.ts`
- Test: none yet (interface only)

- [ ] **Step 1: Create src/tts/provider.ts**

```ts
// src/tts/provider.ts
export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SynthesizeInput {
  text: string;
  voice: string;
  rate: string; // SSML rate, e.g. "+0%"
}

export interface SynthesizeOutput {
  audio: Buffer;          // mp3 bytes
  timings: WordTiming[];
}

export interface TtsProvider {
  readonly id: string;    // e.g. "edge"
  synthesize(input: SynthesizeInput): Promise<SynthesizeOutput>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/tts/provider.ts
git commit -m "feat(tts): TtsProvider interface"
```

---

### Task C3: Mock provider for tests

**Files:**
- Create: `src/tts/mock.ts`
- Test: `tests/unit/tts-mock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/tts-mock.test.ts
import { describe, it, expect } from "vitest";
import { MockTtsProvider } from "../../src/tts/mock.js";

describe("MockTtsProvider", () => {
  it("returns 1s of silence per word with even timings", async () => {
    const p = new MockTtsProvider();
    const out = await p.synthesize({ text: "hello world", voice: "x", rate: "+0%" });
    expect(out.timings).toHaveLength(2);
    expect(out.timings[0].word).toBe("hello");
    expect(out.timings[1].word).toBe("world");
    // 500ms per word
    expect(out.timings[1].endMs).toBe(1000);
    expect(out.audio.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/tts-mock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/tts/mock.ts**

```ts
// src/tts/mock.ts
import type { TtsProvider, SynthesizeInput, SynthesizeOutput, WordTiming } from "./provider.js";

const MS_PER_WORD = 500;

/** Minimal MP3 frame ("silence") — 32 bytes of MPEG-1 layer 3 silence header. */
const SILENCE_FRAME = Buffer.from([
  0xff, 0xfb, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

export class MockTtsProvider implements TtsProvider {
  readonly id = "mock";

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    const words = input.text.split(/\s+/).filter(Boolean);
    const timings: WordTiming[] = words.map((w, i) => ({
      word: w,
      startMs: i * MS_PER_WORD,
      endMs: (i + 1) * MS_PER_WORD,
    }));
    // Allocate enough silence frames to cover total duration
    const totalMs = words.length * MS_PER_WORD;
    const frames = Math.max(1, Math.ceil(totalMs / 26)); // ~26ms per MPEG frame
    const audio = Buffer.concat(Array.from({ length: frames }, () => SILENCE_FRAME));
    return { audio, timings };
  }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/tts-mock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tts/mock.ts tests/unit/tts-mock.test.ts
git commit -m "feat(tts): mock provider for tests"
```

---

### Task C4: Content-addressed cache

**Files:**
- Create: `src/tts/cache.ts`
- Test: `tests/unit/tts-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/tts-cache.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { CachedTtsProvider, computeKey } from "../../src/tts/cache.js";
import { MockTtsProvider } from "../../src/tts/mock.js";

describe("CachedTtsProvider", () => {
  it("hashes (text, voice, rate, providerId) deterministically", () => {
    const k1 = computeKey({ text: "hi", voice: "v1", rate: "+0%", providerId: "edge" });
    const k2 = computeKey({ text: "hi", voice: "v1", rate: "+0%", providerId: "edge" });
    const k3 = computeKey({ text: "hi", voice: "v2", rate: "+0%", providerId: "edge" });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("misses then hits — second call has zero invocations", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-tts-"));
    let calls = 0;
    const inner = new MockTtsProvider();
    const wrapped = {
      id: "mock",
      synthesize: async (input: any) => { calls++; return inner.synthesize(input); },
    };
    const cache = new CachedTtsProvider(wrapped as any, dir);
    await cache.synthesize({ text: "hello world", voice: "x", rate: "+0%" });
    await cache.synthesize({ text: "hello world", voice: "x", rate: "+0%" });
    expect(calls).toBe(1);
    const files = await fs.readdir(dir);
    const hash = computeKey({ text: "hello world", voice: "x", rate: "+0%", providerId: "mock" });
    expect(files).toContain(`${hash}.mp3`);
    expect(files).toContain(`${hash}.timings.json`);
    expect(files).toContain(`${hash}.meta.json`);
  });

  it("treats missing timings as cache miss", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-tts-"));
    let calls = 0;
    const inner = new MockTtsProvider();
    const wrapped = {
      id: "mock",
      synthesize: async (input: any) => { calls++; return inner.synthesize(input); },
    };
    const cache = new CachedTtsProvider(wrapped as any, dir);
    await cache.synthesize({ text: "hi", voice: "x", rate: "+0%" });
    expect(calls).toBe(1);
    // Corrupt: delete timings file
    const hash = computeKey({ text: "hi", voice: "x", rate: "+0%", providerId: "mock" });
    await fs.rm(path.join(dir, `${hash}.timings.json`));
    await cache.synthesize({ text: "hi", voice: "x", rate: "+0%" });
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/tts-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/tts/cache.ts**

```ts
// src/tts/cache.ts
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import type { TtsProvider, SynthesizeInput, SynthesizeOutput, WordTiming } from "./provider.js";

export function computeKey(input: { text: string; voice: string; rate: string; providerId: string }): string {
  const canon = JSON.stringify({
    text: input.text,
    voice: input.voice,
    rate: input.rate,
    providerId: input.providerId,
  });
  return crypto.createHash("sha256").update(canon).digest("hex");
}

export class CachedTtsProvider implements TtsProvider {
  readonly id: string;

  constructor(private inner: TtsProvider, private cacheDir: string) {
    this.id = inner.id;
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    const key = computeKey({ ...input, providerId: this.inner.id });
    await fs.mkdir(this.cacheDir, { recursive: true });
    const mp3 = path.join(this.cacheDir, `${key}.mp3`);
    const timingsFile = path.join(this.cacheDir, `${key}.timings.json`);
    const metaFile = path.join(this.cacheDir, `${key}.meta.json`);

    try {
      const [audio, timingsRaw] = await Promise.all([
        fs.readFile(mp3),
        fs.readFile(timingsFile, "utf8"),
      ]);
      const timings = JSON.parse(timingsRaw) as WordTiming[];
      if (!Array.isArray(timings)) throw new Error("invalid timings");
      return { audio, timings };
    } catch {
      // miss or corrupt — re-synthesize
    }

    const out = await this.inner.synthesize(input);
    await fs.writeFile(mp3, out.audio);
    await fs.writeFile(timingsFile, JSON.stringify(out.timings, null, 2));
    await fs.writeFile(metaFile, JSON.stringify({ ...input, providerId: this.inner.id }, null, 2));
    return out;
  }
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/tts-cache.test.ts`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/tts/cache.ts tests/unit/tts-cache.test.ts
git commit -m "feat(tts): content-addressed cache wrapper"
```

---

### Task C5: AST scanner — extract fx.say() string-literal calls

**Files:**
- Create: `src/tts/scan.ts`
- Test: `tests/unit/tts-scan.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/tts-scan.test.ts
import { describe, it, expect } from "vitest";
import { scanFxSayLiterals } from "../../src/tts/scan.js";

describe("scanFxSayLiterals", () => {
  it("finds simple calls", () => {
    const code = `
      await fx.say("Hello world");
      await page.click("#a");
      const n = fx.say('Goodbye');
    `;
    const calls = scanFxSayLiterals(code);
    expect(calls.map((c) => c.text)).toEqual(["Hello world", "Goodbye"]);
  });

  it("ignores fx.say with template literals (throws)", () => {
    const code = "await fx.say(`Hi ${name}`);";
    expect(() => scanFxSayLiterals(code)).toThrow(/fx\.say requires a string literal/);
  });

  it("ignores fx.say with concatenation (throws)", () => {
    const code = `await fx.say("Hi " + name);`;
    expect(() => scanFxSayLiterals(code)).toThrow(/fx\.say requires a string literal/);
  });

  it("ignores fx.say with variable arg (throws)", () => {
    const code = `const t = "x"; await fx.say(t);`;
    expect(() => scanFxSayLiterals(code)).toThrow(/fx\.say requires a string literal/);
  });

  it("ignores comments and strings that look like fx.say", () => {
    const code = `
      // fx.say("not real");
      const x = "fx.say(\\"also not real\\")";
      await fx.say("real");
    `;
    const calls = scanFxSayLiterals(code);
    expect(calls.map((c) => c.text)).toEqual(["real"]);
  });

  it("returns line numbers (1-based) for each call", () => {
    const code = `await fx.say("a");\nawait fx.say("b");`;
    const calls = scanFxSayLiterals(code);
    expect(calls[0].line).toBe(1);
    expect(calls[1].line).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/tts-scan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/tts/scan.ts**

Implementation uses the TypeScript compiler API (`typescript` is already a devDependency).

```ts
// src/tts/scan.ts
import ts from "typescript";

export interface FxSayCall {
  text: string;
  line: number; // 1-based, relative to the playwright code block
}

export function scanFxSayLiterals(code: string): FxSayCall[] {
  const sf = ts.createSourceFile("scene.ts", code, ts.ScriptTarget.ES2022, /*setParentNodes*/ true);
  const calls: FxSayCall[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "fx" &&
        callee.name.text === "say"
      ) {
        const arg = node.arguments[0];
        if (!arg) {
          throw new Error(`fx.say requires a string literal argument: <empty> at line ${lineOf(node)}`);
        }
        if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
          const excerpt = code.slice(node.getStart(sf), Math.min(code.length, node.getStart(sf) + 80));
          throw new Error(`fx.say requires a string literal: line ${lineOf(node)} "${excerpt.replace(/\n/g, " ")}"`);
        }
        calls.push({ text: arg.text, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  }
  function lineOf(node: ts.Node): number {
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  }

  visit(sf);
  return calls;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/tts-scan.test.ts`
Expected: PASS — all 6 cases.

- [ ] **Step 5: Commit**

```bash
git add src/tts/scan.ts tests/unit/tts-scan.test.ts
git commit -m "feat(tts): scanFxSayLiterals AST walker"
```

---

### Task C6: Edge TTS provider

**Files:**
- Create: `src/tts/edge.ts`
- Test: `tests/unit/tts-edge.test.ts` (smoke — actually hits the network, marked `it.skipIf(!process.env.DAYMO_RUN_EDGE_TTS)`)

The msedge-tts package's exact API may need to be verified during implementation. The wrapper isolates that.

- [ ] **Step 1: Write the smoke test**

```ts
// tests/unit/tts-edge.test.ts
import { describe, it, expect } from "vitest";
import { EdgeTtsProvider } from "../../src/tts/edge.js";

const RUN = !!process.env.DAYMO_RUN_EDGE_TTS;

describe("EdgeTtsProvider (network)", () => {
  it.skipIf(!RUN)("synthesizes hello world with word boundaries", async () => {
    const p = new EdgeTtsProvider();
    const out = await p.synthesize({ text: "Hello world.", voice: "en-US-AriaNeural", rate: "+0%" });
    expect(out.audio.length).toBeGreaterThan(1000);
    expect(out.timings.length).toBeGreaterThanOrEqual(2);
    expect(out.timings[0].word.toLowerCase()).toBe("hello");
    expect(out.timings[0].endMs).toBeGreaterThan(out.timings[0].startMs);
  }, 30_000);

  it("type id is 'edge'", () => {
    expect(new EdgeTtsProvider().id).toBe("edge");
  });
});
```

- [ ] **Step 2: Read the msedge-tts README**

Run: `cat node_modules/msedge-tts/README.md`
Confirm the exported types — specifically the metadata stream's emission shape. The implementation below assumes the documented `MsEdgeTTS#toStream(text)` returns `{ audioStream, metadataStream }` where `metadataStream` emits objects with a `Metadata` array of `{ Type, Data: { Offset, Duration, text: { Text } } }`. **If the actual API differs, adjust the parsing in `src/tts/edge.ts` accordingly — keep the public synthesize() signature unchanged.**

- [ ] **Step 3: Create src/tts/edge.ts**

```ts
// src/tts/edge.ts
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { TtsProvider, SynthesizeInput, SynthesizeOutput, WordTiming } from "./provider.js";

interface BoundaryEvent {
  Metadata?: Array<{
    Type: string;
    Data: {
      Offset: number;     // 100-ns units
      Duration: number;   // 100-ns units
      text?: { Text?: string };
    };
  }>;
}

const HUNDRED_NS_PER_MS = 10_000;

export class EdgeTtsProvider implements TtsProvider {
  readonly id = "edge";

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(input.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // Note: msedge-tts also accepts ssml — we wrap for rate.
    const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${input.voice}"><prosody rate="${input.rate}">${escapeXml(input.text)}</prosody></voice></speak>`;
    const { audioStream, metadataStream } = tts.toStream(ssml as any);

    const audioChunks: Buffer[] = [];
    const timings: WordTiming[] = [];

    audioStream.on("data", (c: Buffer) => audioChunks.push(c));
    metadataStream.on("data", (chunk: BoundaryEvent | Buffer) => {
      const events: BoundaryEvent[] = Buffer.isBuffer(chunk)
        ? safeParse(chunk.toString())
        : [chunk];
      for (const e of events) {
        for (const m of e.Metadata ?? []) {
          if (m.Type === "WordBoundary" && m.Data.text?.Text) {
            const startMs = Math.round(m.Data.Offset / HUNDRED_NS_PER_MS);
            const durMs = Math.round(m.Data.Duration / HUNDRED_NS_PER_MS);
            timings.push({ word: m.Data.text.Text, startMs, endMs: startMs + durMs });
          }
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      audioStream.on("end", () => resolve());
      audioStream.on("error", reject);
    });

    return { audio: Buffer.concat(audioChunks), timings };
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeParse(s: string): BoundaryEvent[] {
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Smoke-test against the live endpoint**

Run: `DAYMO_RUN_EDGE_TTS=1 npx vitest run tests/unit/tts-edge.test.ts`
Expected: PASS. If it fails, the most likely cause is a mismatch between the assumed msedge-tts API shape and the actual one. Adjust the provider to match what the package emits.

- [ ] **Step 5: Run all tests (skipping the network smoke)**

Run: `npx vitest run`
Expected: PASS. The Edge smoke test is skipped without `DAYMO_RUN_EDGE_TTS=1`.

- [ ] **Step 6: Commit**

```bash
git add src/tts/edge.ts tests/unit/tts-edge.test.ts
git commit -m "feat(tts): Edge TTS provider via msedge-tts"
```

---

## Phase D — fx.say / fx.banner runtime + overlay

### Task D1: Parse `tts:` frontmatter

**Files:**
- Modify: `src/types.ts`
- Modify: `src/parser.ts`
- Test: extend `tests/unit/parser.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/parser.test.ts`:

```ts
it("parses tts: frontmatter with defaults applied", () => {
  const src = `---
title: t
url: about:blank
tts:
  voice: en-US-JennyNeural
  rate: "+10%"
---

# S
`;
  const ast = parse(src);
  expect(ast.frontmatter.tts).toEqual({
    provider: "edge",
    voice: "en-US-JennyNeural",
    rate: "+10%",
    music_duck: true,
  });
});

it("applies all defaults when tts: is absent", () => {
  const src = `---
title: t
url: about:blank
---

# S
`;
  const ast = parse(src);
  expect(ast.frontmatter.tts).toEqual({
    provider: "edge",
    voice: "en-US-AriaNeural",
    rate: "+0%",
    music_duck: true,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/parser.test.ts`
Expected: FAIL — `tts` field absent.

- [ ] **Step 3: Update src/types.ts**

```ts
export interface TtsConfig {
  provider: "edge";
  voice: string;
  rate: string;
  music_duck: boolean;
}

export interface Frontmatter {
  title: string;
  description?: string;
  url: string;
  viewport?: { width: number; height: number };
  music?: string;
  mocks?: MockSourceConfig[];
  auth?: { storageState: string };
  tts: TtsConfig;     // always populated post-parse (with defaults)
}
```

Also extend `RunnerEvent`:

```ts
export type RunnerEvent =
  | { kind: "scene_start"; t: number; index: number; title: string; prose: string }
  | { kind: "scene_end"; t: number; index: number }
  | { kind: "fx"; t: number; method: string; args: unknown[] }
  | { kind: "say"; t: number; hash: string; text: string; durationMs: number }
  | { kind: "overlay"; t: number; directive: OverlayDirective; bbox: BBox | null }
  | { kind: "log"; t: number; level: "log" | "warn" | "error"; args: unknown[] }
  | { kind: "error"; t: number; message: string; sceneIndex: number };
```

And extend `DemoFx`:

```ts
export interface DemoFx {
  cursorTo(selector: string, opts?: { duration?: number }): Promise<void>;
  typeWithDelay(selector: string, text: string, cps?: number): Promise<void>;
  zoom(selector: string, factor?: number, duration?: number): Promise<void>;
  pause(seconds: number): Promise<void>;
  callout(text: string, target?: string, duration?: number): Promise<void>;
  highlight(selector: string, duration?: number): Promise<void>;
  say(text: string, opts?: { voice?: string; rate?: string }): Promise<void>;
  banner(text: string, opts?: { duration?: number; title?: string }): Promise<void>;
  hideBanner(): Promise<void>;
}
```

- [ ] **Step 4: Update src/parser.ts to apply defaults**

After parsing frontmatter, fold in defaults:

```ts
const rawTts = (parsed.data as any).tts ?? {};
const frontmatter: Frontmatter = {
  ...(parsed.data as Frontmatter),
  tts: {
    provider: rawTts.provider ?? "edge",
    voice: rawTts.voice ?? "en-US-AriaNeural",
    rate: rawTts.rate ?? "+0%",
    music_duck: rawTts.music_duck ?? true,
  },
};
if (!frontmatter.title || !frontmatter.url) {
  throw new Error("missing or incomplete frontmatter (need `title` and `url`)");
}
```

(Replace the existing `const frontmatter = parsed.data as Frontmatter;` and adjacent validation block.)

- [ ] **Step 5: Run test**

Run: `npx vitest run tests/unit/parser.test.ts`
Expected: PASS.

- [ ] **Step 6: Run all tests + build**

Run: `npx vitest run && npx tsc`
Expected: PASS, builds clean.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/parser.ts tests/unit/parser.test.ts
git commit -m "feat(parser): tts frontmatter with defaults; extend types for say"
```

---

### Task D2: Overlay — karaoke subtitle bar + banner ops

**Files:**
- Modify: `src/overlay.ts` — add `say(hash)`, `banner(text, durationMs?, title?)`, `hideBanner()`, and a `sayTable` registry slot.
- Test: extend `tests/unit/overlay.test.ts` (jsdom-style — exercise the DOM)

- [ ] **Step 1: Write the failing test**

```ts
// extend tests/unit/overlay.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { OVERLAY_INIT_SCRIPT } from "../../src/overlay.js";

let dom: JSDOM;
let win: any;

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`, { runScripts: "dangerously" });
  win = dom.window;
  // Inject the overlay init script into the JSDOM context
  const script = win.document.createElement("script");
  script.textContent = OVERLAY_INIT_SCRIPT;
  win.document.head.appendChild(script);
});

describe("overlay say()", () => {
  it("registers say table entries and shows subtitle bar with first word highlighted at t=0", async () => {
    win.__daymo.sayTable = {
      h1: { durationMs: 1000, words: [{ text: "Hello", startMs: 0, endMs: 500 }, { text: "world", startMs: 500, endMs: 1000 }] },
    };
    // start say but do not await — inspect DOM mid-flight via fake timers? for unit test, just kick off and read.
    const p = win.__daymo.say("h1");
    // The subtitle bar should be in the DOM and visible.
    const bar = win.document.querySelector("[data-daymo-subtitle]");
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain("Hello");
    expect(bar.textContent).toContain("world");
    // Wait for it to resolve — capped at 1100ms in real time for the unit test.
    await p;
  }, 5_000);
});

describe("overlay banner()", () => {
  it("shows a banner that auto-hides after duration", async () => {
    win.__daymo.banner("Step 1", 100, "TITLE");
    const banner = win.document.querySelector("[data-daymo-banner]");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("Step 1");
    await new Promise((r) => setTimeout(r, 150));
    expect((banner as any).style.opacity).toBe("0");
  });

  it("hideBanner hides immediately", () => {
    win.__daymo.banner("X");
    win.__daymo.hideBanner();
    const banner = win.document.querySelector("[data-daymo-banner]");
    expect((banner as any).style.opacity).toBe("0");
  });
});
```

(If `jsdom` isn't already a devDependency, install: `npm install -D jsdom @types/jsdom`. Vitest detects jsdom env automatically when imported.)

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/unit/overlay.test.ts`
Expected: FAIL — `__daymo.say`, `banner`, `hideBanner` undefined; subtitle/banner DOM markers missing.

- [ ] **Step 3: Edit src/overlay.ts**

Within `OVERLAY_INIT_SCRIPT`'s IIFE body, add:

```js
// Inside the existing IIFE, after captionBanner is created:

// Subtitle bar — separate from the legacy caption banner. Word-level karaoke.
const subtitle = document.createElement("div");
subtitle.setAttribute("data-daymo-subtitle", "");
subtitle.style.cssText = [
  "position:absolute",
  "left:50%",
  "bottom:48px",
  "transform:translateX(-50%)",
  "max-width:80%",
  "padding:14px 22px",
  "background:rgba(15,23,42,0.92)",
  "color:#fff",
  "border-radius:12px",
  "font:18px/1.45 -apple-system,system-ui,sans-serif",
  "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
  "opacity:0",
  "transition:opacity 0.2s ease",
  "white-space:pre-wrap",
].join(";");
root.appendChild(subtitle);

// A persistent banner (formerly auto-prose).
const banner = document.createElement("div");
banner.setAttribute("data-daymo-banner", "");
banner.style.cssText = [
  "position:absolute",
  "left:50%",
  "bottom:140px",  // sits above the subtitle bar
  "transform:translateX(-50%)",
  "max-width:80%",
  "padding:14px 22px",
  "background:rgba(15,23,42,0.92)",
  "color:#fff",
  "border-radius:12px",
  "font:18px/1.45 -apple-system,system-ui,sans-serif",
  "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
  "opacity:0",
  "transition:opacity 0.3s ease",
  "white-space:pre-wrap",
].join(";");
const bannerTitle = document.createElement("div");
bannerTitle.style.cssText = "font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.7;margin-bottom:6px;";
const bannerBody = document.createElement("div");
banner.appendChild(bannerTitle);
banner.appendChild(bannerBody);
root.appendChild(banner);

// Karaoke say.
const sayTable = (window.__daymo && window.__daymo.sayTable) || {};
let sayQueue = Promise.resolve();

function say(hash) {
  const entry = (window.__daymo.sayTable || {})[hash];
  if (!entry) return Promise.reject(new Error("say: unknown hash " + hash));
  // Serialize concurrent say() calls — subtitle bar is single-channel.
  sayQueue = sayQueue.then(() => playSay(entry));
  return sayQueue;
}

function playSay(entry) {
  return new Promise((resolve) => {
    mount();
    // Build per-word spans for highlight animation.
    subtitle.innerHTML = "";
    const spans = [];
    for (const w of entry.words) {
      const s = document.createElement("span");
      s.textContent = w.text + " ";
      s.style.transition = "color 0.05s linear, font-weight 0.05s linear";
      subtitle.appendChild(s);
      spans.push(s);
    }
    requestAnimationFrame(() => { subtitle.style.opacity = "1"; });

    const t0 = performance.now();
    let idx = 0;
    function tick() {
      const t = performance.now() - t0;
      while (idx < entry.words.length && t >= entry.words[idx].startMs) {
        // Reset previous
        if (idx > 0) {
          spans[idx - 1].style.color = "#fff";
          spans[idx - 1].style.fontWeight = "400";
        }
        spans[idx].style.color = "#fbbf24";
        spans[idx].style.fontWeight = "700";
        idx++;
      }
      if (t < entry.durationMs) {
        requestAnimationFrame(tick);
      } else {
        // Final word stays highlighted briefly, then fade.
        setTimeout(() => { subtitle.style.opacity = "0"; }, 200);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

function showBanner(text, durationMs, title) {
  mount();
  bannerTitle.textContent = title || "";
  bannerBody.textContent = text || "";
  requestAnimationFrame(() => { banner.style.opacity = "1"; });
  if (typeof durationMs === "number" && durationMs > 0) {
    setTimeout(() => { banner.style.opacity = "0"; }, durationMs);
  }
}

function hideBanner() {
  banner.style.opacity = "0";
}

window.__daymo = Object.assign({}, window.__daymo || {}, {
  moveCursor, highlight, callout, zoom, measure,
  showCaption, hideCaption,
  say, banner: showBanner, hideBanner,
  // sayTable preserved if pre-set:
  sayTable: (window.__daymo && window.__daymo.sayTable) || {},
});
```

(Inline the new methods with the existing return at the bottom — replace the old final `window.__daymo = { ... };` line.)

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/overlay.test.ts`
Expected: PASS — both `say` and `banner` cases.

- [ ] **Step 5: Commit**

```bash
git add src/overlay.ts tests/unit/overlay.test.ts package.json package-lock.json
git commit -m "feat(overlay): karaoke subtitle bar + banner ops"
```

---

### Task D3: fx.say / fx.banner / fx.hideBanner runtime

**Files:**
- Modify: `src/fx.ts`
- Test: `tests/unit/fx-say.test.ts`

`fx.say` looks up the precomputed hash, calls page.evaluate to play the subtitle, awaits durationMs, returns. The hash is computed in node and passed to the page.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/fx-say.test.ts
import { describe, it, expect } from "vitest";
import { createFx } from "../../src/fx.js";

describe("fx.say", () => {
  it("emits a 'say' event with computed hash and pre-known duration", async () => {
    const events: any[] = [];
    let now = 0;
    const calls: any[] = [];

    const fakePage = {
      evaluate: async (_fn: any, args: any) => {
        calls.push(args);
        // Simulate page-side wait of durationMs by advancing the clock.
        now += args.durationMs;
      },
      // unused in this test:
      locator: () => { throw new Error("not used"); },
      waitForTimeout: async () => {},
    } as any;

    const fx = createFx(fakePage, events, () => now, {
      sayTable: { abc123: { durationMs: 1500, words: [{ text: "hi", startMs: 0, endMs: 1500 }] } },
      sayHashFor: (text) => (text === "hi" ? "abc123" : null),
    });

    await fx.say("hi");

    expect(events.find((e) => e.kind === "say")).toMatchObject({
      kind: "say",
      hash: "abc123",
      text: "hi",
      durationMs: 1500,
    });
    expect(calls[0].hash).toBe("abc123");
  });

  it("throws if text was not pre-synthesized", async () => {
    const fx = createFx({} as any, [], () => 0, { sayTable: {}, sayHashFor: () => null });
    await expect(fx.say("nope")).rejects.toThrow(/not pre-synthesized/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/fx-say.test.ts`
Expected: FAIL — `createFx` signature doesn't accept the 4th arg yet.

- [ ] **Step 3: Update src/fx.ts**

Extend `createFx` to accept a sayContext:

```ts
// src/fx.ts
import type { Page } from "playwright";
import type { BBox, DemoFx, RunnerEvent, WordTiming } from "./types.js";

export type Clock = () => number;

export interface SayContext {
  /** map of pre-synthesized hash → { durationMs, words } */
  sayTable: Record<string, { durationMs: number; words: WordTiming[] }>;
  /** lookup hash for a literal text — returns null if not pre-synthesized */
  sayHashFor: (text: string) => string | null;
}

export function createFx(
  page: Page,
  events: RunnerEvent[],
  clock: Clock,
  sayCtx?: SayContext,
): DemoFx {
  function emit(method: string, args: unknown[]) {
    events.push({ kind: "fx", t: clock(), method, args });
  }
  // ... existing measure() unchanged ...

  return {
    // ... existing methods unchanged ...

    async say(text, opts) {
      if (!sayCtx) throw new Error("fx.say is not available outside of capture");
      const hash = sayCtx.sayHashFor(text);
      if (!hash) {
        throw new Error(`fx.say: text not pre-synthesized: "${text.slice(0, 60)}"`);
      }
      const entry = sayCtx.sayTable[hash];
      if (!entry) throw new Error(`fx.say: missing sayTable entry for hash ${hash}`);
      events.push({ kind: "say", t: clock(), hash, text, durationMs: entry.durationMs });
      await page.evaluate(
        ({ hash, durationMs }) => (window as any).__daymo.say(hash),
        { hash, durationMs: entry.durationMs },
      );
    },

    async banner(text, opts) {
      emit("banner", [text, opts]);
      const durationMs = opts?.duration ? opts.duration * 1000 : undefined;
      await page.evaluate(
        ({ text, durationMs, title }) => (window as any).__daymo.banner(text, durationMs, title),
        { text, durationMs: durationMs ?? 0, title: opts?.title ?? "" },
      );
    },

    async hideBanner() {
      emit("hideBanner", []);
      await page.evaluate(() => (window as any).__daymo.hideBanner());
    },
  };
}
```

Add `WordTiming` re-export to `types.ts` (or import from `tts/provider.ts` directly):

```ts
// src/types.ts (top, after existing imports)
export type { WordTiming } from "./tts/provider.js";
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/fx-say.test.ts`
Expected: PASS — both cases.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS — note: `tests/unit/fx.test.ts` may need a small update if it instantiates `createFx` and now hits the new optional arg (the arg is optional, should still pass).

- [ ] **Step 6: Commit**

```bash
git add src/fx.ts src/types.ts tests/unit/fx-say.test.ts
git commit -m "feat(fx): add say/banner/hideBanner with sayContext"
```

---

### Task D4: Controller pre-synthesis pass

**Files:**
- Modify: `src/controller.ts`
- Modify: `src/runner.ts`
- Modify: `src/core/capture.ts`
- Test: extend `tests/integration/controller.test.ts` (or add new `tests/integration/controller-tts.test.ts`)

`Controller.start` accepts a `TtsProvider` (cached). Before each `runScene`, scan the playwright code for `fx.say(...)` literals, synthesize each (cache hits free), inject sayTable as init script before navigation, and create the `fx` instance with the corresponding `sayContext`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/controller-tts.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { Controller } from "../../src/controller.js";
import { MockTtsProvider } from "../../src/tts/mock.js";
import { CachedTtsProvider } from "../../src/tts/cache.js";

describe("controller + TTS", () => {
  it("pre-synthesizes fx.say literals and records say events with offsets", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-ctrl-tts-"));
    const provider = new CachedTtsProvider(new MockTtsProvider(), path.join(dir, "tts"));
    const ctrl = await Controller.start({
      url: "about:blank",
      viewport: { width: 200, height: 200 },
      artifactsDir: dir,
      ttsProvider: provider,
    });
    try {
      await ctrl.runScene({
        sourceLine: 1,
        title: "S",
        prose: "",
        playwrightCode: { code: `await fx.say("hello world");\nawait fx.pause(0.1);`, sourceLine: 1 },
        overlays: [],
      });
    } finally {
      await ctrl.stop();
    }
    const events = JSON.parse(await fs.readFile(path.join(dir, "events.json"), "utf8"));
    const sayEvent = events.find((e: any) => e.kind === "say");
    expect(sayEvent).toBeDefined();
    expect(sayEvent.text).toBe("hello world");
    expect(sayEvent.durationMs).toBe(1000); // mock: 500ms × 2 words
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/controller-tts.test.ts`
Expected: FAIL — `ttsProvider` opt unrecognized; controller doesn't pre-synthesize.

- [ ] **Step 3: Modify src/controller.ts**

Add `ttsProvider` to `ControllerOpts`. Add a pre-synthesis step in `runScene`:

```ts
// src/controller.ts
import { computeKey } from "./tts/cache.js";
import { scanFxSayLiterals } from "./tts/scan.js";
import type { TtsProvider } from "./tts/provider.js";
// ...

export interface ControllerOpts {
  url: string;
  viewport?: { width: number; height: number };
  mocks?: MockSourceConfig[];
  storageStatePath?: string;
  artifactsDir: string;
  ttsProvider?: TtsProvider;
  ttsConfig?: { voice: string; rate: string };
}

// In Controller class:
async runScene(scene: Scene): Promise<void> {
  this.events.push({ kind: "scene_start", t: this.now(), index: scene.sourceLine, title: scene.title, prose: scene.prose });
  try {
    let sayCtx: import("./fx.js").SayContext | undefined;
    if (this.opts.ttsProvider && scene.playwrightCode) {
      const calls = scanFxSayLiterals(scene.playwrightCode.code);
      const sayTable: Record<string, { durationMs: number; words: any[] }> = {};
      const hashByText: Record<string, string> = {};
      const cfg = this.opts.ttsConfig ?? { voice: "en-US-AriaNeural", rate: "+0%" };
      // Synthesize in parallel; cache hits are free.
      await Promise.all(calls.map(async (c) => {
        const out = await this.opts.ttsProvider!.synthesize({ text: c.text, voice: cfg.voice, rate: cfg.rate });
        const hash = computeKey({ text: c.text, voice: cfg.voice, rate: cfg.rate, providerId: this.opts.ttsProvider!.id });
        const totalMs = out.timings.length ? out.timings[out.timings.length - 1].endMs : 0;
        sayTable[hash] = { durationMs: totalMs, words: out.timings };
        hashByText[c.text] = hash;
      }));
      // Inject sayTable into the page.
      await this.page.evaluate((table) => { (window as any).__daymo.sayTable = table; }, sayTable);
      sayCtx = {
        sayTable,
        sayHashFor: (text) => hashByText[text] ?? null,
      };
    }

    if (scene.playwrightCode) {
      const fx = createFx(this.page, this.events, () => this.now(), sayCtx);
      // ... rest unchanged ...
    }
    // ... overlays loop unchanged ...
    this.events.push({ kind: "scene_end", t: this.now(), index: scene.sourceLine });
  } catch (e) { /* unchanged */ }
}
```

- [ ] **Step 4: Modify src/runner.ts to plumb ttsProvider**

```ts
// src/runner.ts
import { CachedTtsProvider } from "./tts/cache.js";
import { EdgeTtsProvider } from "./tts/edge.js";
import { MockTtsProvider } from "./tts/mock.js";
import path from "node:path";
// ...

export async function render(opts: RenderOpts): Promise<{ mp4Path: string; artifactsDir: string }> {
  // ... existing ast parse, baseDir, artifactsDir setup ...

  const dotDir = path.join(baseDir, ".daymo");
  const ttsCacheDir = path.join(dotDir, "tts");
  const innerProvider = process.env.DAYMO_TTS_PROVIDER === "mock" ? new MockTtsProvider() : new EdgeTtsProvider();
  const ttsProvider = new CachedTtsProvider(innerProvider, ttsCacheDir);

  const ctrl = await Controller.start({
    url: ast.frontmatter.url,
    viewport: ast.frontmatter.viewport,
    mocks: ast.frontmatter.mocks,
    storageStatePath: ast.frontmatter.auth?.storageState
      ? path.resolve(baseDir, ast.frontmatter.auth.storageState)
      : undefined,
    artifactsDir,
    ttsProvider,
    ttsConfig: { voice: ast.frontmatter.tts.voice, rate: ast.frontmatter.tts.rate },
  });
  // ... rest unchanged ...
}
```

- [ ] **Step 5: Modify src/core/capture.ts to plumb ttsProvider**

```ts
// src/core/capture.ts
import { CachedTtsProvider } from "../tts/cache.js";
import { EdgeTtsProvider } from "../tts/edge.js";
import { MockTtsProvider } from "../tts/mock.js";
import path from "node:path";
// ...

export async function captureSingleScene(
  ast: DemoAst,
  sceneIndex: number,
  opts: CaptureSingleSceneOpts,
): Promise<CaptureSingleSceneResult> {
  // ... existing scene check, mkdir, baseDir, tmpArtifacts ...

  const dotDir = path.join(path.dirname(opts.demoFile), ".daymo");
  const ttsCacheDir = path.join(dotDir, "tts");
  const innerProvider = process.env.DAYMO_TTS_PROVIDER === "mock" ? new MockTtsProvider() : new EdgeTtsProvider();
  const ttsProvider = new CachedTtsProvider(innerProvider, ttsCacheDir);

  const ctrl = await Controller.start({
    url: ast.frontmatter.url,
    viewport: ast.frontmatter.viewport,
    mocks: ast.frontmatter.mocks,
    storageStatePath: ast.frontmatter.auth?.storageState
      ? path.resolve(baseDir, ast.frontmatter.auth.storageState)
      : undefined,
    artifactsDir: tmpArtifacts,
    ttsProvider,
    ttsConfig: { voice: ast.frontmatter.tts.voice, rate: ast.frontmatter.tts.rate },
  });
  // ... rest unchanged ...
}
```

- [ ] **Step 6: Run integration test (with DAYMO_TTS_PROVIDER=mock so no network)**

Run: `DAYMO_TTS_PROVIDER=mock npx tsc && DAYMO_TTS_PROVIDER=mock npx vitest run tests/integration/controller-tts.test.ts`

Expected: PASS.

- [ ] **Step 7: Run full test suite**

Run: `DAYMO_TTS_PROVIDER=mock npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/controller.ts src/runner.ts src/core/capture.ts tests/integration/controller-tts.test.ts
git commit -m "feat(controller): TTS pre-synthesis + sayTable injection"
```

---

## Phase E — stitch-time audio mixing + sidechain ducking

### Task E1: Per-scene audio mix args builder

**Files:**
- Create: `src/core/scene-audio.ts`
- Test: `tests/unit/scene-audio-args.test.ts`

This produces ffmpeg arguments that take a scene's webm + N TTS mp3s + their offsets and produce a webm-with-narration.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scene-audio-args.test.ts
import { describe, it, expect } from "vitest";
import { buildSceneAudioArgs, type SceneAudioInput } from "../../src/core/scene-audio.js";

describe("buildSceneAudioArgs", () => {
  it("returns input args + concat for video-only when no say events", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [],
      ttsDir: "/tts",
    });
    expect(a).toEqual(["-y", "-i", "/cap/scene-001.webm", "-c", "copy", "/cap/scene-001.with-audio.webm"]);
  });

  it("delays each TTS file by its t and amixes", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [
        { hash: "h1", t: 500 },
        { hash: "h2", t: 4750 },
      ],
      ttsDir: "/tts",
    });
    expect(a).toEqual([
      "-y",
      "-i", "/cap/scene-001.webm",
      "-i", "/tts/h1.mp3",
      "-i", "/tts/h2.mp3",
      "-filter_complex",
      "[1:a]adelay=500|500[a1];[2:a]adelay=4750|4750[a2];[a1][a2]amix=inputs=2:duration=longest[narr]",
      "-map", "0:v",
      "-map", "[narr]",
      "-c:v", "copy",
      "-c:a", "aac",
      "/cap/scene-001.with-audio.webm",
    ]);
  });

  it("single say event uses adelay alone (no amix)", () => {
    const a = buildSceneAudioArgs({
      sceneWebm: "/cap/scene-001.webm",
      output: "/cap/scene-001.with-audio.webm",
      sayEvents: [{ hash: "h1", t: 0 }],
      ttsDir: "/tts",
    });
    expect(a).toEqual([
      "-y",
      "-i", "/cap/scene-001.webm",
      "-i", "/tts/h1.mp3",
      "-filter_complex",
      "[1:a]adelay=0|0[narr]",
      "-map", "0:v",
      "-map", "[narr]",
      "-c:v", "copy",
      "-c:a", "aac",
      "/cap/scene-001.with-audio.webm",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/scene-audio-args.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/core/scene-audio.ts**

```ts
// src/core/scene-audio.ts
import path from "node:path";

export interface SayEvent { hash: string; t: number; }

export interface SceneAudioInput {
  sceneWebm: string;
  output: string;
  sayEvents: SayEvent[];
  ttsDir: string;
}

export function buildSceneAudioArgs(opts: SceneAudioInput): string[] {
  if (opts.sayEvents.length === 0) {
    return ["-y", "-i", opts.sceneWebm, "-c", "copy", opts.output];
  }
  const argv: string[] = ["-y", "-i", opts.sceneWebm];
  for (const ev of opts.sayEvents) {
    argv.push("-i", path.join(opts.ttsDir, `${ev.hash}.mp3`));
  }
  const labels: string[] = [];
  const filterChunks: string[] = [];
  for (let i = 0; i < opts.sayEvents.length; i++) {
    const ev = opts.sayEvents[i];
    const inLabel = i + 1; // input index in ffmpeg
    const outLabel = opts.sayEvents.length === 1 ? "narr" : `a${i + 1}`;
    filterChunks.push(`[${inLabel}:a]adelay=${ev.t}|${ev.t}[${outLabel}]`);
    labels.push(`[${outLabel}]`);
  }
  if (opts.sayEvents.length > 1) {
    filterChunks.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest[narr]`);
  }
  argv.push(
    "-filter_complex", filterChunks.join(";"),
    "-map", "0:v",
    "-map", "[narr]",
    "-c:v", "copy",
    "-c:a", "aac",
    opts.output,
  );
  return argv;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/scene-audio-args.test.ts`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/scene-audio.ts tests/unit/scene-audio-args.test.ts
git commit -m "feat(stitch): per-scene audio mix args builder"
```

---

### Task E2: Update buildStitchArgs to support sidechain ducking

**Files:**
- Modify: `src/core/concat.ts`
- Modify: `tests/unit/concat-args.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/concat-args.test.ts`:

```ts
it("sidechain-ducks music against narration when musicDuck=true", () => {
  const a = buildStitchArgs({
    listFile: "/tmp/list.txt",
    music: "/m.mp3",
    output: "/o.mp4",
    musicDuck: true,
  });
  expect(a).toEqual([
    "-y","-f","concat","-safe","0","-i","/tmp/list.txt",
    "-i","/m.mp3",
    "-filter_complex",
    "[1:a]volume=0.4[bg];[bg][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[ducked];[ducked][0:a]amix=inputs=2:duration=first[final]",
    "-map","0:v","-map","[final]",
    "-c:v","libx264","-c:a","aac",
    "-shortest",
    "/o.mp4",
  ]);
});

it("falls back to constant volume when musicDuck=false", () => {
  const a = buildStitchArgs({ listFile: "/tmp/list.txt", music: "/m.mp3", output: "/o.mp4", musicDuck: false });
  expect(a).toEqual([
    "-y","-f","concat","-safe","0","-i","/tmp/list.txt",
    "-i","/m.mp3",
    "-filter_complex","[1:a]volume=0.4[m]",
    "-map","0:v","-map","[m]",
    "-c:v","libx264","-c:a","aac",
    "-shortest",
    "/o.mp4",
  ]);
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run tests/unit/concat-args.test.ts`
Expected: FAIL — `musicDuck` not honored.

- [ ] **Step 3: Update src/core/concat.ts**

```ts
export interface BuildStitchArgsOpts {
  listFile: string;
  music: string | null;
  output: string;
  musicVolume?: number;
  musicDuck?: boolean;       // NEW
}

export function buildStitchArgs(opts: BuildStitchArgsOpts): string[] {
  const argv: string[] = ["-y", "-f", "concat", "-safe", "0", "-i", opts.listFile];
  if (opts.music) {
    const vol = (opts.musicVolume ?? 0.4).toFixed(1);
    if (opts.musicDuck) {
      argv.push(
        "-i", opts.music,
        "-filter_complex",
        `[1:a]volume=${vol}[bg];[bg][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[ducked];[ducked][0:a]amix=inputs=2:duration=first[final]`,
        "-map", "0:v",
        "-map", "[final]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-shortest",
        opts.output,
      );
    } else {
      argv.push(
        "-i", opts.music,
        "-filter_complex", `[1:a]volume=${vol}[m]`,
        "-map", "0:v",
        "-map", "[m]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-shortest",
        opts.output,
      );
    }
  } else {
    argv.push("-an", "-c:v", "libx264", opts.output);
  }
  return argv;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run tests/unit/concat-args.test.ts`
Expected: PASS — both new cases plus the existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/core/concat.ts tests/unit/concat-args.test.ts
git commit -m "feat(stitch): sidechain ducking option for bg music"
```

---

### Task E3: End-to-end stitch with audio mix + bg music

**Files:**
- Modify: `src/core/stitch.ts`
- Modify: `src/commands/stitch.ts` (uses new options)
- Modify: `src/editor/index.ts` (passes ttsConfig + sayEvents)
- Test: `tests/integration/tts-end-to-end.test.ts`

The `stitch()` core fn now accepts say events per scene + tts directory. It produces per-scene `.with-audio.webm` first, then concats those.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/tts-end-to-end.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

describe("end-to-end TTS render (mock provider)", () => {
  it("captures + stitches a demo with fx.say and produces an audible output.mp4", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-e2e-tts-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, `---
title: tiny
url: about:blank
viewport: { width: 200, height: 200 }
---

# One

\`\`\`playwright
await fx.say("hello world");
await fx.pause(0.2);
\`\`\`
`);
    await execa("node", [cliBin, "capture", file, "--all"], { env: { ...process.env, DAYMO_TTS_PROVIDER: "mock" } });
    await execa("node", [cliBin, "stitch", file], { env: { ...process.env, DAYMO_TTS_PROVIDER: "mock" } });

    const out = path.join(dir, "output.mp4");
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);

    // Probe via ffprobe to assert there is an audio stream
    const { stdout } = await execa("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", out]);
    const probed = JSON.parse(stdout);
    const types = probed.streams.map((s: any) => s.codec_type);
    expect(types).toContain("audio");
  }, 120_000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc && DAYMO_TTS_PROVIDER=mock npx vitest run tests/integration/tts-end-to-end.test.ts`
Expected: FAIL — output likely lacks audio because `stitch` doesn't yet mix in the scene's say events.

- [ ] **Step 3: Update src/core/stitch.ts**

```ts
// src/core/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { buildConcatList, buildStitchArgs } from "./concat.js";
import { buildSceneAudioArgs, type SayEvent } from "./scene-audio.js";

export interface SceneInput {
  webm: string;
  sayEvents: SayEvent[];   // [] if scene has no narration
}

export interface StitchOpts {
  scenes: SceneInput[];
  music: string | null;
  output: string;
  workDir: string;
  ttsDir: string;
  musicVolume?: number;
  musicDuck?: boolean;
  onLine?: (line: string) => void;
}

export async function stitch(opts: StitchOpts): Promise<string> {
  // Per-scene audio mix
  const mixedScenes: string[] = [];
  for (let i = 0; i < opts.scenes.length; i++) {
    const sc = opts.scenes[i];
    if (sc.sayEvents.length === 0) {
      mixedScenes.push(sc.webm);
      continue;
    }
    // Verify TTS files exist before invoking ffmpeg
    for (const ev of sc.sayEvents) {
      const f = path.join(opts.ttsDir, `${ev.hash}.mp3`);
      try { await fs.access(f); }
      catch { throw new Error(`missing TTS audio for scene ${i + 1}: ${ev.hash}. Re-run: daymo capture <file> --scene ${i + 1}`); }
    }
    const out = path.join(opts.workDir, `scene-${String(i + 1).padStart(3, "0")}.with-audio.webm`);
    await execa("ffmpeg", buildSceneAudioArgs({
      sceneWebm: sc.webm,
      output: out,
      sayEvents: sc.sayEvents,
      ttsDir: opts.ttsDir,
    }));
    mixedScenes.push(out);
  }

  const listFile = path.join(opts.workDir, "concat-list.txt");
  await fs.writeFile(listFile, buildConcatList(mixedScenes));
  const args = buildStitchArgs({
    listFile,
    music: opts.music,
    output: opts.output,
    musicVolume: opts.musicVolume,
    musicDuck: opts.musicDuck,
  });
  const proc = execa("ffmpeg", args);
  if (opts.onLine && proc.stderr) {
    proc.stderr.setEncoding("utf8");
    let buf = "";
    proc.stderr.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) opts.onLine!(line);
    });
  }
  await proc;
  return opts.output;
}
```

- [ ] **Step 4: Update src/commands/stitch.ts to read events.json**

```ts
// src/commands/stitch.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { loadState } from "../core/store.js";
import { stitch, type SceneInput } from "../core/stitch.js";

export async function stitchCommand(file: string): Promise<void> {
  const demoFile = path.resolve(file);
  const baseDir = path.dirname(demoFile);
  const dotDir = path.join(baseDir, ".daymo");
  const stateFile = path.join(dotDir, "state.json");
  const ttsDir = path.join(dotDir, "tts");

  const ast = parse(await fs.readFile(demoFile, "utf8"));
  const state = await loadState(stateFile, ast.scenes, demoFile);

  const pending = state.scenes.flatMap((r, i) => r.state === "pending" ? [i + 1] : []);
  if (pending.length > 0) {
    throw new Error(`scenes not captured: ${pending.join(", ")} — run: daymo capture <file> --all`);
  }

  const scenes: SceneInput[] = [];
  for (const r of state.scenes) {
    let sayEvents: { hash: string; t: number }[] = [];
    if (r.eventsPath) {
      const raw = await fs.readFile(r.eventsPath, "utf8");
      const events: any[] = JSON.parse(raw);
      sayEvents = events
        .filter((e) => e.kind === "say")
        .map((e) => ({ hash: e.hash, t: e.t }));
    }
    scenes.push({ webm: r.webmPath!, sayEvents });
  }

  const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  const output = path.join(baseDir, "output.mp4");

  await stitch({
    scenes,
    music,
    output,
    workDir: dotDir,
    ttsDir,
    musicDuck: ast.frontmatter.tts.music_duck,
    onLine: () => {},
  });
  process.stdout.write(`${output}\n`);
}
```

- [ ] **Step 5: Update src/editor/index.ts**

The editor's `stitchNow` calls `core/stitch`. Update to pass `scenes` + `ttsDir` + `musicDuck`:

```ts
const stitchNow = async () => {
  const ttsDir = path.join(dotDir, "tts");
  const scenes: import("../core/stitch.js").SceneInput[] = [];
  for (const r of state.scenes) {
    let sayEvents: { hash: string; t: number }[] = [];
    if (r.eventsPath) {
      const raw = await fs.readFile(r.eventsPath, "utf8");
      const events: any[] = JSON.parse(raw);
      sayEvents = events.filter((e: any) => e.kind === "say").map((e: any) => ({ hash: e.hash, t: e.t }));
    }
    scenes.push({ webm: r.webmPath!, sayEvents });
  }
  const baseDir = path.dirname(demoFile);
  const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  const out = path.join(baseDir, "output.mp4");
  await stitch({
    scenes,
    music,
    output: out,
    workDir: dotDir,
    ttsDir,
    musicDuck: ast.frontmatter.tts.music_duck,
    onLine: (l) => sse.publish({ type: "stitch-progress", line: l }),
  });
  sse.publish({ type: "stitch-done", output: out });
  return out;
};
```

- [ ] **Step 6: Update src/runner.ts (full pipeline) to mix audio**

After the controller writes events.json + raw_page.webm, build the per-scene mix path. Simplest approach: extract per-scene boundaries by scanning events.json for `scene_start` / `scene_end` and slicing the raw video isn't trivial — instead, leave `daymo render` as today (no per-scene mix; falls back to single-pass with bg music only). Document that for full TTS mix the user uses `daymo capture --all && daymo stitch`. Add a TODO comment in `src/runner.ts`:

```ts
// NOTE: `daymo render` runs all scenes in a single capture and does not currently
// per-scene-mix narration audio. For TTS-narrated demos, use:
//   daymo capture <file> --all && daymo stitch <file>
// Full-pipeline TTS mixing in `render` is future work.
```

- [ ] **Step 7: Run e2e test**

Run: `npx tsc && DAYMO_TTS_PROVIDER=mock npx vitest run tests/integration/tts-end-to-end.test.ts`
Expected: PASS.

- [ ] **Step 8: Run full test suite**

Run: `DAYMO_TTS_PROVIDER=mock npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/core/stitch.ts src/commands/stitch.ts src/editor/index.ts src/runner.ts tests/integration/tts-end-to-end.test.ts
git commit -m "feat(stitch): per-scene audio mix + bg music ducking"
```

---

## Phase F — migrate-prose helper + repo demo migration

### Task F1: migrate-prose helper

**Files:**
- Create: `src/commands/migrate-prose.ts`
- Modify: `src/cli.ts`
- Test: `tests/unit/migrate-prose.test.ts`

Walks scenes, takes prose under each heading, prepends `await fx.say("…");\n` to the playwright block (or creates a new playwright block if absent), and removes the prose. Idempotent (skip if `fx.say(prose)` already present).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/migrate-prose.test.ts
import { describe, it, expect } from "vitest";
import { migrateProseToFxSay } from "../../src/commands/migrate-prose.js";

describe("migrateProseToFxSay", () => {
  it("wraps prose into fx.say at top of playwright block", () => {
    const src = `---
title: t
url: about:blank
---

# One

This is the intro.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;
    const out = migrateProseToFxSay(src);
    expect(out).toMatch(/^await fx\.say\("This is the intro\."\);\nawait fx\.pause/m);
    expect(out).not.toMatch(/This is the intro\./m); // prose now removed from markdown body
  });

  it("creates a playwright block when scene had none", () => {
    const src = `---
title: t
url: about:blank
---

# One

Hello.
`;
    const out = migrateProseToFxSay(src);
    expect(out).toMatch(/```playwright\nawait fx\.say\("Hello\."\);\n```/);
  });

  it("is idempotent", () => {
    const src = `---
title: t
url: about:blank
---

# One

Hi.

\`\`\`playwright
await fx.say("Hi.");
await fx.pause(0.1);
\`\`\`
`;
    const once = migrateProseToFxSay(src);
    const twice = migrateProseToFxSay(once);
    expect(twice).toBe(once);
  });

  it("escapes embedded quotes", () => {
    const src = `---
title: t
url: about:blank
---

# One

She said "hi".

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;
    const out = migrateProseToFxSay(src);
    expect(out).toMatch(/fx\.say\("She said \\"hi\\"\."\)/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/migrate-prose.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create src/commands/migrate-prose.ts**

```ts
// src/commands/migrate-prose.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";

export async function migrateProseCommand(file: string): Promise<void> {
  const demoFile = path.resolve(file);
  const src = await fs.readFile(demoFile, "utf8");
  const next = migrateProseToFxSay(src);
  await fs.writeFile(demoFile, next);
  process.stdout.write(`${demoFile}\n`);
}

export function migrateProseToFxSay(source: string): string {
  // Parse to discover scene boundaries.
  const ast = parse(source);
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  // Walk scenes from last to first to preserve line indices.
  for (let i = ast.scenes.length - 1; i >= 0; i--) {
    const scene = ast.scenes[i];
    const prose = scene.prose.trim();
    if (!prose) continue;

    // Find prose lines (same logic as rewriteSceneProse)
    const headingLine = scene.sourceLine - 1;
    let proseStart = headingLine + 1;
    while (proseStart < lines.length && lines[proseStart].trim() === "") proseStart++;
    let proseEnd = proseStart;
    while (proseEnd < lines.length) {
      const l = lines[proseEnd];
      if (/^```/.test(l) || l.trim() === "---" || /^#\s/.test(l)) break;
      proseEnd++;
    }
    while (proseEnd > proseStart && lines[proseEnd - 1].trim() === "") proseEnd--;

    const sayCall = `await fx.say(${JSON.stringify(prose)});`;
    const playwrightStart = scene.playwrightCode?.sourceLine; // 1-based, the fence line

    if (playwrightStart) {
      const fenceIdx = playwrightStart - 1; // convert to 0-based
      const nextLine = lines[fenceIdx + 1] ?? "";
      // Idempotent: skip if first line already calls fx.say with this text
      if (nextLine.trim() === sayCall.trim()) {
        // Remove the prose lines, keep the existing fx.say
        lines.splice(proseStart, proseEnd - proseStart);
        continue;
      }
      // Insert sayCall as the new first line of the playwright block.
      lines.splice(fenceIdx + 1, 0, sayCall);
      // Now the prose lines have shifted by +1
      lines.splice(proseStart, proseEnd - proseStart);
    } else {
      // No playwright block — create one at the position where prose was.
      const newBlock = ["```playwright", sayCall, "```"];
      lines.splice(proseStart, proseEnd - proseStart, ...newBlock);
    }
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Register in src/cli.ts**

```ts
import { migrateProseCommand } from "./commands/migrate-prose.js";
// ...
cli.command("migrate-prose <file>", "Wrap each scene's prose into fx.say() and remove from markdown body")
  .action((file: string) => migrateProseCommand(file));
```

- [ ] **Step 5: Run test**

Run: `npx vitest run tests/unit/migrate-prose.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 6: Commit**

```bash
git add src/commands/migrate-prose.ts src/cli.ts tests/unit/migrate-prose.test.ts
git commit -m "feat(cli): add daymo migrate-prose helper"
```

---

### Task F2: Migrate the two repo demos

**Files:**
- Modify: `screenassist-tour.demo`
- Modify: `screenassist-app-tour.demo`
- Modify: `demo-tour.demo`

- [ ] **Step 1: Build CLI**

Run: `npx tsc`

- [ ] **Step 2: Migrate the three demos**

Run:
```bash
node dist/cli.js migrate-prose screenassist-tour.demo
node dist/cli.js migrate-prose screenassist-app-tour.demo
node dist/cli.js migrate-prose demo-tour.demo
```

- [ ] **Step 3: Sanity check — render one demo with mock TTS**

Run: `DAYMO_TTS_PROVIDER=mock node dist/cli.js capture screenassist-app-tour.demo --scene 1`
Expected: capture succeeds; `.daymo/captures/scene-001.events.json` contains `kind: "say"` events for the migrated prose.

- [ ] **Step 4: Commit**

```bash
git add screenassist-tour.demo screenassist-app-tour.demo demo-tour.demo
git commit -m "chore: migrate repo demos to fx.say (prose → say calls)"
```

---

## Phase G — CLI/editor parity test + final docs

### Task G1: CLI/editor parity test

**Files:**
- Test: `tests/integration/cli-parity.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/integration/cli-parity.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { startEditor } from "../../src/editor/index.js";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

const tinyDemo = `---
title: tiny
url: about:blank
viewport: { width: 200, height: 200 }
---

# Scene one

\`\`\`playwright
await fx.say("hello");
await fx.pause(0.1);
\`\`\`
`;

async function tmpDemo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-parity-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, tinyDemo);
  return file;
}

function postCapture(port: number, sceneIndex: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "localhost", port, path: `/api/capture/${sceneIndex}`, method: "POST" }, (res) => {
      res.on("data", () => {});
      res.on("end", () => res.statusCode === 202 ? resolve() : reject(new Error(`status ${res.statusCode}`)));
    });
    req.end();
  });
}

describe("CLI / editor parity", () => {
  it("editor capture and CLI capture produce identical events.json shapes", async () => {
    process.env.DAYMO_TTS_PROVIDER = "mock";
    const fileA = await tmpDemo();
    const fileB = await tmpDemo();

    // CLI path
    await execa("node", [cliBin, "capture", fileA, "--scene", "1"], { env: process.env });
    const cliEvents = JSON.parse(await fs.readFile(path.join(path.dirname(fileA), ".daymo/captures/scene-001.events.json"), "utf8"));

    // Editor path
    const h = await startEditor({ demoFile: fileB, port: 0 });
    try {
      await postCapture(h.port, 0);
      // Wait for capture to finish
      let tries = 0;
      while (tries++ < 60) {
        try {
          const events = JSON.parse(await fs.readFile(path.join(path.dirname(fileB), ".daymo/captures/scene-001.events.json"), "utf8"));
          if (events.find((e: any) => e.kind === "scene_end")) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      await h.stop();
    }
    const editorEvents = JSON.parse(await fs.readFile(path.join(path.dirname(fileB), ".daymo/captures/scene-001.events.json"), "utf8"));

    // Compare shape: same kinds in same order
    const cliKinds = cliEvents.map((e: any) => e.kind);
    const editorKinds = editorEvents.map((e: any) => e.kind);
    expect(editorKinds).toEqual(cliKinds);

    // Same say hashes (deterministic by input)
    const cliSay = cliEvents.find((e: any) => e.kind === "say");
    const editorSay = editorEvents.find((e: any) => e.kind === "say");
    expect(editorSay.hash).toBe(cliSay.hash);
    expect(editorSay.text).toBe(cliSay.text);
    expect(editorSay.durationMs).toBe(cliSay.durationMs);
  }, 120_000);
});
```

- [ ] **Step 2: Run**

Run: `npx tsc && DAYMO_TTS_PROVIDER=mock npx vitest run tests/integration/cli-parity.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/cli-parity.test.ts
git commit -m "test: CLI vs editor capture produces identical event shape"
```

---

### Task G2: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update commands section**

Replace the "Commands" section with:

```markdown
## Commands

```
daymo render <file>                          Execute the demo and produce output.mp4
daymo doctor                                 Verify Playwright and ffmpeg are configured
daymo edit <file>                            Open the visual editor for a .demo file

daymo capture <file> --scene N | --all       Capture one scene (1-indexed) or all scenes
daymo stitch <file>                          Compose all captured scenes into output.mp4
daymo state <file> [--json]                  Show scene status table (or JSON)
daymo set-prose <file> --scene N --text "…"  Rewrite a scene's prose markdown
daymo migrate-prose <file>                   Wrap existing prose into fx.say() calls
```

Outputs land in `./artifacts/<id>/` for `daymo render`, or in `<demo-dir>/output.mp4` for `daymo stitch`. The state directory `<demo-dir>/.daymo/` holds per-scene captures (`captures/`), state (`state.json`), and the TTS audio cache (`tts/`).
```

- [ ] **Step 2: Add a "Narration" section**

After the `fx` runtime section, insert:

```markdown
### Narration with `fx.say`

Daymo can narrate scenes using free Edge TTS. Inside a `playwright` block:

\`\`\`js
// Sequential narration — voice finishes, then click
await fx.say("Click the new project button to begin.");
await page.click("[data-testid='new-project-btn']");

// Parallel — voice plays while cursor moves
const n = fx.say("Welcome back, Alex. Your dashboard.");
await fx.cursorTo("h1");
await fx.pause(0.5);
await n;
\`\`\`

While the voice plays, a karaoke-style subtitle bar shows the sentence with the currently-spoken word highlighted. The first time a string is synthesized, it's cached at `<demo-dir>/.daymo/tts/<hash>.mp3` — re-renders are cache hits.

**Constraint:** the text passed to `fx.say` must be a string literal (not a template literal or variable).

Frontmatter overrides (all optional):

\`\`\`yaml
tts:
  voice: en-US-AriaNeural
  rate: "+0%"
  music_duck: true   # auto-lower bg music while voice plays
\`\`\`

For an opt-in static caption banner (the old auto-prose behavior), use `fx.banner(text, { duration?: seconds, title?: string })`.

### Pipeline: `render` vs `capture` + `stitch`

`daymo render` runs everything in one shot but does not yet per-scene-mix narration audio. For TTS-narrated demos, use the two-step pipeline:

\`\`\`bash
daymo capture my.demo --all
daymo stitch my.demo
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README — new CLI commands + fx.say"
```

---

## Self-Review

Run through this once after writing the plan; fix issues inline.

**1. Spec coverage:**
- ✅ CLI parity: A6 (server drops approve), B1–B4 (state, capture, stitch, set-prose). Migration helper: F1.
- ✅ TTS provider: C2 (interface), C3 (mock), C4 (cache), C5 (scanner), C6 (Edge impl). 
- ✅ fx.say + fx.banner: D2 (overlay), D3 (fx runtime), D4 (controller pre-synthesis).
- ✅ Stitch audio: E1 (scene mix args), E2 (sidechain duck), E3 (end-to-end).
- ✅ Approval removal: A1 (new reducer), A6 (editor + UI cleanup).
- ✅ Persisted state backcompat: A1's `loadState` coerces `"approved"` → `"captured"`.
- ✅ Errors: handled in commands (A6 stitch gate), C5 (scan throws), E3 (missing TTS file error).
- ✅ Repo demo migration: F2.
- ✅ CLI/editor parity test: G1.
- ✅ Docs: G2.

**2. Placeholder scan:** No "TBD" / "implement later" / etc. The msedge-tts boundary parsing in C6 has a verify-during-implementation note, but provides a concrete implementation that's expected to work — that's not a placeholder, it's a known integration risk with mitigation guidance.

**3. Type consistency:**
- `SceneState` = `"pending" | "captured"` everywhere (A1, editor types in A6).
- `StitchOpts` shape changed in E3 — uses `scenes: SceneInput[]` instead of `scenePaths: string[]`. Editor `index.ts` updated in E3 step 5; CLI `stitchCommand` updated in E3 step 4.
- `WordTiming` defined in `tts/provider.ts`, re-exported from `types.ts` (D3 step 3).
- `SayContext` defined in `fx.ts` (D3 step 3), used by `controller.ts` (D4 step 3).
- `computeKey` signature consistent across C4 + D4.

All consistent.

---

## Execution

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-cli-parity-and-tts-narration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
