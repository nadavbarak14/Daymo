# Visual Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `daymo edit <demo.demo>` localhost web editor with per-scene capture, PR-style batched review comments handed to Claude Code via clipboard, inline caption editing, and gated final stitch.

**Architecture:** New `src/editor/` module hosts a Node `http` server (REST + SSE) that wraps a refactored single-scene capture and an ffmpeg concat stitcher, persisting per-scene state under `<project>/.daymo/`. A `editor-ui/` Vite+React+Tailwind+shadcn project builds into `dist/editor-ui/` and is served as static files. The editor never calls an LLM; **Submit review** formats a Markdown prompt from in-memory drafts and writes it to the clipboard.

**Tech Stack:**
- Backend: existing TypeScript/Node + ESM. Add `chokidar` for file watching.
- UI: Vite, React 18, TypeScript, Tailwind CSS 3.4, shadcn/ui (Radix-based).
- Tests: existing `vitest` (`tests/unit`, `tests/integration`, `tests/e2e`).
- Process: `execa` (already a dep) for ffmpeg.

---

## File map

### Modified
- `package.json` — add deps + `build` runs both tsc and vite, `files` ships `dist/editor-ui`
- `tsconfig.json` — exclude `editor-ui/` from server tsc
- `vitest.config.ts` — keep as-is (UI tests use editor-ui's own config if any; logic tests live under `tests/`)
- `src/cli.ts` — add `edit` subcommand
- `.gitignore` — add `editor-ui/dist/` and `editor-ui/node_modules/`

### New backend (`src/`)
- `src/single-capture.ts` — capture one scene → `{webm, events}`
- `src/editor/types.ts` — shared types for state and SSE events
- `src/editor/state.ts` — state shape, reducers, `.daymo/state.json` IO
- `src/editor/script-rewrite.ts` — replace one scene's prose in `.demo`
- `src/editor/concat.ts` — pure ffmpeg concat-list + args builders
- `src/editor/stitch.ts` — stitch driver (calls execa)
- `src/editor/watcher.ts` — chokidar wrapper, debounce, self-write sentinel
- `src/editor/sse.ts` — server-sent events bus
- `src/editor/server.ts` — Node http server + route table + static
- `src/editor/api.ts` — endpoint handlers
- `src/editor/index.ts` — `startEditor(opts)` public entry
- `src/commands/edit.ts` — CLI command wiring

### New UI (`editor-ui/`)
- `editor-ui/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`
- `editor-ui/index.html`
- `editor-ui/tailwind.config.ts`, `postcss.config.js`, `src/index.css`
- `editor-ui/components.json` (shadcn/ui)
- `editor-ui/src/main.tsx`, `App.tsx`
- `editor-ui/src/lib/api.ts` — typed REST client
- `editor-ui/src/lib/sse.ts` — useSSE hook
- `editor-ui/src/lib/prompt.ts` — submit-review markdown formatter
- `editor-ui/src/lib/types.ts` — duplicate of `src/editor/types.ts` (no shared package)
- `editor-ui/src/store.ts` — small zustand store
- `editor-ui/src/components/Rail.tsx`, `Preview.tsx`, `Tabs.tsx`, `Script.tsx`, `Overlays.tsx`, `Errors.tsx`, `Composer.tsx`, `ReviewBar.tsx`, `StitchBar.tsx`
- `editor-ui/src/components/ui/*` — shadcn components (button, tabs, badge, dialog, textarea)

### Tests
- `tests/integration/single-capture.test.ts`
- `tests/unit/concat-args.test.ts`
- `tests/unit/script-rewrite.test.ts`
- `tests/unit/state-reducer.test.ts`
- `tests/unit/watcher.test.ts`
- `tests/integration/editor-server.test.ts`
- `tests/integration/editor-stitch.test.ts`
- `tests/unit/prompt-format.test.ts` (uses editor-ui's prompt.ts via relative import OR a copy in src/editor for shared testing)
- `tests/e2e/edit-smoke.test.ts`

> **Note on `lib/prompt.ts` testing:** keep `prompt.ts` in BOTH `src/editor/` (server-importable, unit-tested by vitest) AND re-imported by `editor-ui/src/lib/prompt.ts` via a relative path from the UI package. UI imports `../../../src/editor/prompt.ts` is awkward; instead, put the canonical file at `src/editor/prompt.ts` and have `editor-ui/src/lib/prompt.ts` simply re-export from a vendored copy. Plan keeps two sources of the same trivial logic in lockstep — they are pure string formatting and ~50 LoC.
>
> Decision: write the canonical at `src/editor/prompt.ts`, and copy-paste the file into `editor-ui/src/lib/prompt.ts` (with the same content) so the UI build is self-contained. Tests run against `src/editor/prompt.ts`. The duplication is small and the test catches drift if anyone edits one but not the other (a future task can write a script that rewrites the UI copy from the canonical).

---

## Milestone 1 — Per-scene capture

### Task 1: Single-scene capture function

**Files:**
- Create: `src/single-capture.ts`
- Test: `tests/integration/single-capture.test.ts`
- Reference: `src/controller.ts`, `src/runner.ts`, `tests/integration/controller.test.ts` for fixture wiring.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/single-capture.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { startSampleApp, stopSampleApp } from "./server.js";
import { parse } from "../../src/parser.js";
import { captureSingleScene } from "../../src/single-capture.js";

let appUrl: string;
beforeAll(async () => { appUrl = await startSampleApp(); }, 30_000);
afterAll(async () => { await stopSampleApp(); });

describe("captureSingleScene", () => {
  it("produces a webm + events for one scene", async () => {
    const demoFile = path.resolve("tests/fixtures/demos/smoke.demo");
    const ast = parse(await fs.readFile(demoFile, "utf8"));
    const ast2 = { ...ast, frontmatter: { ...ast.frontmatter, url: appUrl } };

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cap-"));
    const out = await captureSingleScene(ast2, 0, {
      capturesDir: tmp,
      demoFile,
    });

    expect(out.webm).toMatch(/scene-001\.webm$/);
    const stat = await fs.stat(out.webm);
    expect(stat.size).toBeGreaterThan(0);

    const events = JSON.parse(await fs.readFile(out.events, "utf8"));
    expect(events.find((e: any) => e.kind === "scene_start")).toBeTruthy();
    expect(events.find((e: any) => e.kind === "scene_end")).toBeTruthy();
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/integration/single-capture.test.ts
```
Expected: FAIL — `captureSingleScene` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/single-capture.ts
import path from "node:path";
import fs from "node:fs/promises";
import { Controller } from "./controller.js";
import type { DemoAst } from "./types.js";

export interface CaptureSingleSceneOpts {
  /** Directory to write `scene-<NNN>.webm` and `scene-<NNN>.events.json` into. */
  capturesDir: string;
  /** Path to the source `.demo`, used as the basedir for storageState/music. */
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

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/integration/single-capture.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/single-capture.ts tests/integration/single-capture.test.ts
git commit -m "feat(capture): single-scene capture helper"
```

---

## Milestone 2 — Stitch

### Task 2: ffmpeg concat args (pure)

**Files:**
- Create: `src/editor/concat.ts`
- Test: `tests/unit/concat-args.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/concat-args.test.ts
import { describe, it, expect } from "vitest";
import { buildConcatList, buildStitchArgs } from "../../src/editor/concat.js";

describe("buildConcatList", () => {
  it("emits 'file' lines with single-quote escaping for ffmpeg concat demuxer", () => {
    const txt = buildConcatList([
      "/abs/scene-001.webm",
      "/abs/cap with space/scene-002.webm",
    ]);
    expect(txt.trim().split("\n")).toEqual([
      "file '/abs/scene-001.webm'",
      "file '/abs/cap with space/scene-002.webm'",
    ]);
  });
});

describe("buildStitchArgs", () => {
  it("uses concat demuxer + libx264, no audio when no music", () => {
    const a = buildStitchArgs({ listFile: "/tmp/list.txt", music: null, output: "/o.mp4" });
    expect(a).toEqual(["-y","-f","concat","-safe","0","-i","/tmp/list.txt","-an","-c:v","libx264","/o.mp4"]);
  });
  it("muxes music with default volume 0.4", () => {
    const a = buildStitchArgs({ listFile: "/tmp/list.txt", music: "/m.mp3", output: "/o.mp4" });
    expect(a).toEqual([
      "-y","-f","concat","-safe","0","-i","/tmp/list.txt",
      "-i","/m.mp3",
      "-filter_complex","[1:a]volume=0.4[m]",
      "-map","0:v","-map","[m]",
      "-c:v","libx264","-c:a","aac",
      "/o.mp4",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/unit/concat-args.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/concat.ts
export function buildConcatList(scenePaths: string[]): string {
  return scenePaths.map((p) => `file '${p}'`).join("\n") + "\n";
}

export interface BuildStitchArgsOpts {
  listFile: string;
  music: string | null;
  output: string;
  musicVolume?: number;
}

export function buildStitchArgs(opts: BuildStitchArgsOpts): string[] {
  const argv: string[] = ["-y", "-f", "concat", "-safe", "0", "-i", opts.listFile];
  if (opts.music) {
    const vol = (opts.musicVolume ?? 0.4).toFixed(1);
    argv.push(
      "-i", opts.music,
      "-filter_complex", `[1:a]volume=${vol}[m]`,
      "-map", "0:v",
      "-map", "[m]",
      "-c:v", "libx264",
      "-c:a", "aac",
      opts.output,
    );
  } else {
    argv.push("-an", "-c:v", "libx264", opts.output);
  }
  return argv;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/unit/concat-args.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/concat.ts tests/unit/concat-args.test.ts
git commit -m "feat(editor): pure ffmpeg concat args builder"
```

---

### Task 3: Stitch driver

**Files:**
- Create: `src/editor/stitch.ts`
- Test: `tests/integration/editor-stitch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/editor-stitch.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execa } from "execa";
import { stitch } from "../../src/editor/stitch.js";

async function makeTinyWebm(out: string) {
  await execa("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=red:size=320x240:duration=1:rate=30",
    "-c:v", "libvpx", out,
  ]);
}

describe("stitch", () => {
  it("concatenates two clips and produces an mp4", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-stitch-"));
    const a = path.join(tmp, "scene-001.webm");
    const b = path.join(tmp, "scene-002.webm");
    await makeTinyWebm(a);
    await makeTinyWebm(b);
    const out = path.join(tmp, "output.mp4");
    await stitch({ scenePaths: [a, b], music: null, output: out, workDir: tmp });
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/integration/editor-stitch.test.ts
```
Expected: FAIL — `stitch` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/stitch.ts
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

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/integration/editor-stitch.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/stitch.ts tests/integration/editor-stitch.test.ts
git commit -m "feat(editor): stitch driver around ffmpeg concat"
```

---

## Milestone 3 — State

### Task 4: State types + reducer

**Files:**
- Create: `src/editor/types.ts`, `src/editor/state.ts`
- Test: `tests/unit/state-reducer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/state-reducer.test.ts
import { describe, it, expect } from "vitest";
import { initialState, reduce } from "../../src/editor/state.js";

describe("state reducer", () => {
  const base = initialState({
    demoFile: "/p/demo.demo",
    scenes: [
      { sourceLine: 5, title: "S1", prose: "p1", overlays: [] },
      { sourceLine: 9, title: "S2", prose: "p2", overlays: [] },
    ] as any,
  });

  it("captureDone marks captured + stores webm path", () => {
    const s = reduce(base, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm" });
    expect(s.scenes[0].state).toBe("captured");
    expect(s.scenes[0].webmPath).toBe("/cap/scene-001.webm");
  });

  it("approve only allowed when captured", () => {
    expect(() => reduce(base, { type: "approve", sceneIndex: 0, approved: true })).toThrow(/not captured/);
    const s2 = reduce(base, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm" });
    const s3 = reduce(s2, { type: "approve", sceneIndex: 0, approved: true });
    expect(s3.scenes[0].state).toBe("approved");
  });

  it("demo edit drops a captured scene back to pending", () => {
    let s = reduce(base, { type: "capture-done", sceneIndex: 0, webmPath: "/x.webm" });
    s = reduce(s, { type: "approve", sceneIndex: 0, approved: true });
    s = reduce(s, { type: "scene-changed", sceneIndex: 0 });
    expect(s.scenes[0].state).toBe("pending");
    expect(s.scenes[0].webmPath).toBeUndefined();
  });

  it("allApproved is true only when all scenes approved", () => {
    let s = base;
    expect(s.allApproved).toBe(false);
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/a.webm" });
    s = reduce(s, { type: "approve", sceneIndex: 0, approved: true });
    s = reduce(s, { type: "capture-done", sceneIndex: 1, webmPath: "/b.webm" });
    s = reduce(s, { type: "approve", sceneIndex: 1, approved: true });
    expect(s.allApproved).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/unit/state-reducer.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/types.ts
import type { Scene } from "../types.js";

export type SceneState = "pending" | "captured" | "approved";

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
  allApproved: boolean;
}

export type StateAction =
  | { type: "capture-start"; sceneIndex: number }
  | { type: "capture-done"; sceneIndex: number; webmPath: string; eventsPath?: string }
  | { type: "capture-error"; sceneIndex: number; message: string }
  | { type: "approve"; sceneIndex: number; approved: boolean }
  | { type: "scene-changed"; sceneIndex: number }
  | { type: "scenes-replaced"; scenes: Scene[] };
```

```ts
// src/editor/state.ts
import type { Scene } from "../types.js";
import type { EditorState, SceneRow, StateAction } from "./types.js";

export interface InitialStateOpts {
  demoFile: string;
  scenes: Scene[];
}

export function initialState(opts: InitialStateOpts): EditorState {
  return {
    demoFile: opts.demoFile,
    scenes: opts.scenes.map(toRow),
    allApproved: false,
  };
}

function toRow(s: Scene): SceneRow {
  return { sourceLine: s.sourceLine, title: s.title, prose: s.prose, overlays: s.overlays, state: "pending" };
}

function withRow(s: EditorState, i: number, patch: Partial<SceneRow>): EditorState {
  const scenes = s.scenes.map((row, idx) => (idx === i ? { ...row, ...patch } : row));
  const allApproved = scenes.length > 0 && scenes.every((r) => r.state === "approved");
  return { ...s, scenes, allApproved };
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
    case "approve": {
      const row = s.scenes[a.sceneIndex];
      if (!row) throw new Error(`scene ${a.sceneIndex} not found`);
      if (a.approved && row.state === "pending") throw new Error("not captured yet");
      return withRow(s, a.sceneIndex, { state: a.approved ? "approved" : "captured" });
    }
    case "scene-changed":
      return withRow(s, a.sceneIndex, { state: "pending", webmPath: undefined, eventsPath: undefined, capturedAt: undefined });
    case "scenes-replaced":
      return { ...s, scenes: a.scenes.map(toRow), allApproved: false };
    default:
      return s;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/unit/state-reducer.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/types.ts src/editor/state.ts tests/unit/state-reducer.test.ts
git commit -m "feat(editor): state types + reducer"
```

---

### Task 5: Persist state to .daymo/state.json

**Files:**
- Modify: `src/editor/state.ts` (add `loadState`, `saveState`)
- Test: extend `tests/unit/state-reducer.test.ts` or add `tests/integration/state-persist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/state-persist.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { initialState, reduce, saveState, loadState } from "../../src/editor/state.js";

describe("state persistence", () => {
  it("saves and loads approval flags + capture metadata", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-state-"));
    const file = path.join(tmp, "state.json");
    let s = initialState({
      demoFile: "/p/demo.demo",
      scenes: [{ sourceLine: 5, title: "S1", prose: "", overlays: [] }] as any,
    });
    s = reduce(s, { type: "capture-done", sceneIndex: 0, webmPath: "/cap/scene-001.webm" });
    s = reduce(s, { type: "approve", sceneIndex: 0, approved: true });
    await saveState(file, s);

    const loaded = await loadState(file, s.scenes.map((r) => ({ sourceLine: r.sourceLine, title: r.title, prose: r.prose, overlays: r.overlays })) as any, "/p/demo.demo");
    expect(loaded.scenes[0].state).toBe("approved");
    expect(loaded.scenes[0].webmPath).toBe("/cap/scene-001.webm");
    expect(loaded.allApproved).toBe(true);
  });

  it("loadState falls back to initial when file missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-state-"));
    const file = path.join(tmp, "missing.json");
    const loaded = await loadState(file, [{ sourceLine: 1, title: "S", prose: "", overlays: [] }] as any, "/p/demo.demo");
    expect(loaded.scenes[0].state).toBe("pending");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/integration/state-persist.test.ts
```
Expected: FAIL — saveState/loadState not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/editor/state.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";

interface Persisted {
  version: 1;
  scenes: Array<{
    sourceLine: number;
    state: import("./types.js").SceneState;
    webmPath?: string;
    eventsPath?: string;
    capturedAt?: number;
  }>;
}

export async function saveState(file: string, s: EditorState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data: Persisted = {
    version: 1,
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
    if (persisted.state === "captured" || persisted.state === "approved") {
      if (persisted.webmPath) {
        s = reduce(s, { type: "capture-done", sceneIndex: i, webmPath: persisted.webmPath, eventsPath: persisted.eventsPath });
      }
    }
    if (persisted.state === "approved") {
      s = reduce(s, { type: "approve", sceneIndex: i, approved: true });
    }
  }
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/integration/state-persist.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/state.ts tests/integration/state-persist.test.ts
git commit -m "feat(editor): persist state to .daymo/state.json"
```

---

## Milestone 4 — Caption rewrite

### Task 6: Rewrite a scene's prose without breaking the .demo

**Files:**
- Create: `src/editor/script-rewrite.ts`
- Test: `tests/unit/script-rewrite.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/script-rewrite.test.ts
import { describe, it, expect } from "vitest";
import { rewriteSceneProse } from "../../src/editor/script-rewrite.js";
import { parse } from "../../src/parser.js";

const SAMPLE = `---
title: T
url: http://x
---

# Welcome

Old prose.

\`\`\`playwright
await page.waitForSelector("h1");
\`\`\`

---

# Two

Second prose.
`;

describe("rewriteSceneProse", () => {
  it("replaces prose for the targeted scene only", () => {
    const updated = rewriteSceneProse(SAMPLE, 0, "New welcome line.");
    expect(updated).toContain("# Welcome\n\nNew welcome line.\n\n```playwright");
    expect(updated).toContain("# Two\n\nSecond prose.");
    const ast = parse(updated);
    expect(ast.scenes[0].prose).toBe("New welcome line.");
    expect(ast.scenes[1].prose).toBe("Second prose.");
  });

  it("works for the last scene with no fence after the prose", () => {
    const updated = rewriteSceneProse(SAMPLE, 1, "Replaced.");
    const ast = parse(updated);
    expect(ast.scenes[1].prose).toBe("Replaced.");
  });

  it("throws when the round-trip breaks scene count", () => {
    expect(() => rewriteSceneProse(SAMPLE, 0, "Looks fine\n\n# Sneaky scene\n")).toThrow(/scene count/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/unit/script-rewrite.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/script-rewrite.ts
import { parse } from "../parser.js";

export function rewriteSceneProse(source: string, sceneIndex: number, newProse: string): string {
  const ast = parse(source);
  if (sceneIndex < 0 || sceneIndex >= ast.scenes.length) {
    throw new Error(`scene index ${sceneIndex} out of range`);
  }
  const lines = source.split("\n");
  const scene = ast.scenes[sceneIndex];
  const headingLine = scene.sourceLine - 1;

  // Find prose start: first non-blank line after the heading.
  let proseStart = headingLine + 1;
  while (proseStart < lines.length && lines[proseStart].trim() === "") proseStart++;

  // Find prose end: line before the first fence or scene break or next heading.
  let proseEnd = proseStart;
  while (proseEnd < lines.length) {
    const l = lines[proseEnd];
    if (/^```/.test(l) || l.trim() === "---" || /^#\s/.test(l)) break;
    proseEnd++;
  }
  while (proseEnd > proseStart && lines[proseEnd - 1].trim() === "") proseEnd--;

  const before = lines.slice(0, proseStart);
  const after = lines.slice(proseEnd);
  const proseLines = newProse.replace(/\r\n/g, "\n").split("\n");
  const next = [...before, ...proseLines, ...after].join("\n");

  const newAst = parse(next);
  if (newAst.scenes.length !== ast.scenes.length) {
    throw new Error(`rewrite changed scene count (${ast.scenes.length} → ${newAst.scenes.length})`);
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/unit/script-rewrite.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/script-rewrite.ts tests/unit/script-rewrite.test.ts
git commit -m "feat(editor): caption rewrite preserves .demo structure"
```

---

## Milestone 5 — Watcher

### Task 7: Chokidar wrapper with debounce + sentinel

**Files:**
- Modify: `package.json` (add `chokidar`)
- Create: `src/editor/watcher.ts`
- Test: `tests/unit/watcher.test.ts`

- [ ] **Step 1: Add chokidar**

```
npm install chokidar@^4
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/watcher.test.ts
import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { Watcher } from "../../src/editor/watcher.js";

describe("Watcher", () => {
  it("fires once per debounced burst, ignores self-writes", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-watch-"));
    const f = path.join(tmp, "demo.demo");
    await fs.writeFile(f, "x");

    const onChange = vi.fn();
    const w = new Watcher({ paths: [f], debounceMs: 50, onChange });
    await w.start();

    w.suppressNext();
    await fs.writeFile(f, "y"); // should be suppressed
    await new Promise((r) => setTimeout(r, 80));
    expect(onChange).not.toHaveBeenCalled();

    await fs.writeFile(f, "z"); // real edit
    await fs.writeFile(f, "z2");
    await new Promise((r) => setTimeout(r, 80));
    expect(onChange).toHaveBeenCalledTimes(1);

    await w.stop();
  }, 5_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

```
npx vitest run tests/unit/watcher.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/editor/watcher.ts
import chokidar, { type FSWatcher } from "chokidar";

export interface WatcherOpts {
  paths: string[];
  debounceMs?: number;
  onChange: (changedPath: string) => void;
}

export class Watcher {
  private fsw: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private suppressionCount = 0;
  constructor(private opts: WatcherOpts) {}

  async start(): Promise<void> {
    this.fsw = chokidar.watch(this.opts.paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 10 },
    });
    this.fsw.on("all", (_evt, p) => {
      if (this.suppressionCount > 0) {
        this.suppressionCount--;
        return;
      }
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.opts.onChange(p), this.opts.debounceMs ?? 100);
    });
    await new Promise<void>((res) => this.fsw!.once("ready", () => res()));
  }

  /** Tell the watcher to ignore the next event on these paths (used right before our own write). */
  suppressNext(count = 1): void {
    this.suppressionCount += count;
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.fsw?.close();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```
npx vitest run tests/unit/watcher.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add package.json package-lock.json src/editor/watcher.ts tests/unit/watcher.test.ts
git commit -m "feat(editor): file watcher with debounce + self-write suppression"
```

---

## Milestone 6 — Server

### Task 8: SSE bus

**Files:**
- Create: `src/editor/sse.ts`
- Test: covered by Task 10's server test (no separate unit — it's a thin pub/sub).

- [ ] **Step 1: Write implementation**

```ts
// src/editor/sse.ts
import type { ServerResponse } from "node:http";

export interface SseEvent { type: string; [key: string]: unknown; }

export class SseBus {
  private clients = new Set<ServerResponse>();

  attach(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    res.write(": connected\n\n");
    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  publish(evt: SseEvent): void {
    const payload = `data: ${JSON.stringify(evt)}\n\n`;
    for (const c of this.clients) c.write(payload);
  }

  closeAll(): void {
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}
```

- [ ] **Step 2: Commit**

```
git add src/editor/sse.ts
git commit -m "feat(editor): SSE bus"
```

---

### Task 9: Editor server scaffold + GET /api/state

**Files:**
- Create: `src/editor/api.ts`, `src/editor/server.ts`, `src/editor/index.ts`
- Test: `tests/integration/editor-server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/editor-server.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { startEditor, type EditorHandle } from "../../src/editor/index.js";

let h: EditorHandle;
let demoFile: string;

beforeAll(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-editor-"));
  demoFile = path.join(tmp, "demo.demo");
  await fs.writeFile(demoFile, `---
title: T
url: http://x
---

# A

prose A
`);
  h = await startEditor({ demoFile, port: 0 });
});

afterAll(async () => { await h?.stop(); });

describe("GET /api/state", () => {
  it("returns parsed scenes with pending state", async () => {
    const r = await fetch(`${h.url}/api/state`);
    const j = await r.json();
    expect(j.demoFile).toBe(demoFile);
    expect(j.scenes).toHaveLength(1);
    expect(j.scenes[0].state).toBe("pending");
    expect(j.scenes[0].title).toBe("A");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/integration/editor-server.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/api.ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { EditorState } from "./types.js";
import type { SseBus } from "./sse.js";

export interface ApiCtx {
  getState(): EditorState;
  sse: SseBus;
}

export async function handleGetState(ctx: ApiCtx, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(ctx.getState()));
}

export async function handleEvents(ctx: ApiCtx, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  ctx.sse.attach(res);
}

export function notFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

export function methodNotAllowed(res: ServerResponse): void {
  res.writeHead(405, { "content-type": "text/plain" });
  res.end("method not allowed");
}
```

```ts
// src/editor/server.ts
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { SseBus } from "./sse.js";
import type { EditorState } from "./types.js";
import { handleGetState, handleEvents, notFound, methodNotAllowed } from "./api.js";

export interface ServerOpts {
  port: number;
  getState: () => EditorState;
}

export interface ServerHandle {
  url: string;
  port: number;
  sse: SseBus;
  stop(): Promise<void>;
}

export async function startServer(opts: ServerOpts): Promise<ServerHandle> {
  const sse = new SseBus();
  const ctx = { getState: opts.getState, sse };

  const srv = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/api/state" && req.method === "GET") return handleGetState(ctx, res);
      if (url.pathname === "/api/events" && req.method === "GET") return handleEvents(ctx, req, res);
      notFound(res);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end((e as Error).message);
    }
  });

  await new Promise<void>((resolve) => srv.listen(opts.port, "127.0.0.1", () => resolve()));
  const port = (srv.address() as any).port as number;
  return {
    url: `http://localhost:${port}`,
    port,
    sse,
    stop: () =>
      new Promise<void>((resolve) => {
        sse.closeAll();
        srv.close(() => resolve());
      }),
  };
}
```

```ts
// src/editor/index.ts
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { initialState, loadState, saveState } from "./state.js";
import type { EditorState } from "./types.js";
import { startServer, type ServerHandle } from "./server.js";

export interface StartEditorOpts {
  demoFile: string;
  port?: number;
}

export interface EditorHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export async function startEditor(opts: StartEditorOpts): Promise<EditorHandle> {
  const demoFile = path.resolve(opts.demoFile);
  const dotDir = path.join(path.dirname(demoFile), ".daymo");
  const stateFile = path.join(dotDir, "state.json");

  const source = await fs.readFile(demoFile, "utf8");
  const ast = parse(source);
  let state: EditorState = await loadState(stateFile, ast.scenes, demoFile);

  const srv: ServerHandle = await startServer({
    port: opts.port ?? 0,
    getState: () => state,
  });

  return {
    url: srv.url,
    port: srv.port,
    stop: async () => { await srv.stop(); await saveState(stateFile, state); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/integration/editor-server.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/api.ts src/editor/server.ts src/editor/index.ts tests/integration/editor-server.test.ts
git commit -m "feat(editor): http server + GET /api/state"
```

---

### Task 10: POST /api/capture/:n + capture queue

**Files:**
- Create: `src/editor/capture.ts`
- Modify: `src/editor/api.ts` (add handler), `src/editor/server.ts` (route), `src/editor/index.ts` (wire)
- Test: extend `tests/integration/editor-server.test.ts` with a capture test that uses sample-app.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/editor-server.test.ts`:

```ts
import { startSampleApp, stopSampleApp } from "./server.js";

describe("POST /api/capture/:n", () => {
  let appUrl: string;
  let h2: EditorHandle;
  beforeAll(async () => { appUrl = await startSampleApp(); }, 30_000);
  afterAll(async () => { await stopSampleApp(); await h2?.stop(); });

  it("captures a scene and updates state via SSE", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cap-server-"));
    const file = path.join(tmp, "demo.demo");
    await fs.writeFile(file, `---
title: T
url: ${appUrl}
---

# A

prose
`);
    h2 = await startEditor({ demoFile: file, port: 0 });

    const events: any[] = [];
    const ev = new EventSource(`${h2.url}/api/events`);
    ev.onmessage = (m) => events.push(JSON.parse(m.data));
    await new Promise((r) => setTimeout(r, 50));

    const r = await fetch(`${h2.url}/api/capture/0`, { method: "POST" });
    expect(r.ok).toBe(true);

    // Wait up to 20s for capture-done
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (events.some((e) => e.type === "capture-done" && e.sceneIndex === 0)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(events.find((e) => e.type === "capture-done")).toBeTruthy();

    const state = await (await fetch(`${h2.url}/api/state`)).json();
    expect(state.scenes[0].state).toBe("captured");
    ev.close();
  }, 30_000);
});
```

> Note: depends on `eventsource` polyfill in Node — vitest in Node 20+ has fetch but not EventSource. Add `npm install -D eventsource@^4` and `import { EventSource } from "eventsource";`. Adjust import accordingly.

- [ ] **Step 2: Add EventSource polyfill**

```
npm install -D eventsource@^4
```

Update test imports:
```ts
import { EventSource } from "eventsource";
```

- [ ] **Step 3: Run test to verify it fails**

```
npx vitest run tests/integration/editor-server.test.ts
```
Expected: FAIL — endpoint missing.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/editor/capture.ts
import path from "node:path";
import { captureSingleScene } from "../single-capture.js";
import type { DemoAst } from "../types.js";
import type { SseBus } from "./sse.js";

export interface CaptureQueueOpts {
  getAst: () => DemoAst;
  capturesDir: string;
  demoFile: string;
  sse: SseBus;
  onDone: (sceneIndex: number, webm: string, events: string) => void;
  onError: (sceneIndex: number, message: string) => void;
}

export class CaptureQueue {
  private running = false;
  private q: number[] = [];
  constructor(private opts: CaptureQueueOpts) {}

  enqueue(sceneIndex: number): void {
    this.q.push(sceneIndex);
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.q.length) {
      const i = this.q.shift()!;
      this.opts.sse.publish({ type: "capture-start", sceneIndex: i });
      try {
        const out = await captureSingleScene(this.opts.getAst(), i, {
          capturesDir: this.opts.capturesDir,
          demoFile: this.opts.demoFile,
        });
        this.opts.onDone(i, out.webm, out.events);
        this.opts.sse.publish({ type: "capture-done", sceneIndex: i, webmPath: out.webm });
      } catch (e) {
        const msg = (e as Error).message;
        this.opts.onError(i, msg);
        this.opts.sse.publish({ type: "capture-error", sceneIndex: i, message: msg });
      }
    }
    this.running = false;
  }
}
```

Modify `src/editor/api.ts`:

```ts
export interface CaptureCtx extends ApiCtx {
  enqueueCapture(sceneIndex: number): void;
  sceneCount(): number;
}

export async function handleCapture(ctx: CaptureCtx, sceneIndex: number, res: ServerResponse): Promise<void> {
  if (sceneIndex < 0 || sceneIndex >= ctx.sceneCount()) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "scene out of range" })) as any;
  }
  ctx.enqueueCapture(sceneIndex);
  res.writeHead(202, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}
```

Modify `src/editor/server.ts`:

```ts
// extend ServerOpts
export interface ServerOpts {
  port: number;
  getState: () => EditorState;
  enqueueCapture: (sceneIndex: number) => void;
}

// inside the request handler add:
const m = url.pathname.match(/^\/api\/capture\/(\d+)$/);
if (m && req.method === "POST") {
  return handleCapture({ ...ctx, enqueueCapture: opts.enqueueCapture, sceneCount: () => opts.getState().scenes.length }, Number(m[1]), res);
}
```

Modify `src/editor/index.ts`:

```ts
// after creating state and before startServer:
import { reduce } from "./state.js";
import { CaptureQueue } from "./capture.js";

const capturesDir = path.join(dotDir, "captures");
const queue = new CaptureQueue({
  getAst: () => parse(/* lazily re-read */ "" /* replaced below */) as any,
  capturesDir,
  demoFile,
  sse: undefined as any,
  onDone: (i, webm, events) => { state = reduce(state, { type: "capture-done", sceneIndex: i, webmPath: webm, eventsPath: events }); },
  onError: (i, msg) => { state = reduce(state, { type: "capture-error", sceneIndex: i, message: msg }); },
});
```

> The above sketch has wiring issues; here is the consolidated `index.ts` after this task:

```ts
// src/editor/index.ts (full)
import path from "node:path";
import fs from "node:fs/promises";
import { parse } from "../parser.js";
import { initialState, loadState, saveState, reduce } from "./state.js";
import type { EditorState } from "./types.js";
import { startServer, type ServerHandle } from "./server.js";
import { CaptureQueue } from "./capture.js";
import { SseBus } from "./sse.js";

export interface StartEditorOpts { demoFile: string; port?: number; }
export interface EditorHandle { url: string; port: number; stop(): Promise<void>; }

export async function startEditor(opts: StartEditorOpts): Promise<EditorHandle> {
  const demoFile = path.resolve(opts.demoFile);
  const dotDir = path.join(path.dirname(demoFile), ".daymo");
  const stateFile = path.join(dotDir, "state.json");
  const capturesDir = path.join(dotDir, "captures");

  const sse = new SseBus();
  const readAst = async () => parse(await fs.readFile(demoFile, "utf8"));
  let ast = await readAst();
  let state: EditorState = await loadState(stateFile, ast.scenes, demoFile);

  const queue = new CaptureQueue({
    getAst: () => ast,
    capturesDir,
    demoFile,
    sse,
    onDone: (i, webm, events) => {
      state = reduce(state, { type: "capture-done", sceneIndex: i, webmPath: webm, eventsPath: events });
      void saveState(stateFile, state);
    },
    onError: (i, msg) => {
      state = reduce(state, { type: "capture-error", sceneIndex: i, message: msg });
    },
  });

  const srv: ServerHandle = await startServer({
    port: opts.port ?? 0,
    getState: () => state,
    enqueueCapture: (i) => queue.enqueue(i),
  });
  // hand the SSE bus from server to be the same one we built
  // (small simplification: pass it in)

  return {
    url: srv.url,
    port: srv.port,
    stop: async () => { await srv.stop(); await saveState(stateFile, state); },
  };
}
```

> Refactor: have `startServer` accept an existing `sse: SseBus` rather than constructing its own. Update `ServerOpts` and the server file accordingly:

```ts
// src/editor/server.ts changes
export interface ServerOpts {
  port: number;
  sse: SseBus;
  getState: () => EditorState;
  enqueueCapture: (sceneIndex: number) => void;
}
```

- [ ] **Step 5: Run test to verify it passes**

```
npx vitest run tests/integration/editor-server.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/editor/capture.ts src/editor/api.ts src/editor/server.ts src/editor/index.ts package.json package-lock.json tests/integration/editor-server.test.ts
git commit -m "feat(editor): POST /api/capture queues a per-scene capture"
```

---

### Task 11: POST /api/approve/:n

**Files:**
- Modify: `src/editor/api.ts`, `src/editor/server.ts`, `src/editor/index.ts`
- Test: extend `tests/integration/editor-server.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/editor-server.test.ts`:

```ts
describe("POST /api/approve/:n", () => {
  it("rejects approval when scene not captured", async () => {
    const r = await fetch(`${h.url}/api/approve/0`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ approved: true }) });
    expect(r.status).toBe(409);
  });
});
```

(Where `h` is the editor handle from the existing setup that has only a parsed scene, not captured.)

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/integration/editor-server.test.ts -t approve
```
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/api.ts (add)
export interface ApproveCtx extends ApiCtx { approve(sceneIndex: number, approved: boolean): void; }

export async function handleApprove(ctx: ApproveCtx, sceneIndex: number, body: { approved: boolean }, res: ServerResponse): Promise<void> {
  try {
    ctx.approve(sceneIndex, !!body.approved);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
```

```ts
// src/editor/server.ts (route additions)
const am = url.pathname.match(/^\/api\/approve\/(\d+)$/);
if (am && req.method === "POST") {
  const body = await readJson<{ approved: boolean }>(req);
  return handleApprove({ ...ctx, approve: opts.approve }, Number(am[1]), body, res);
}
```

```ts
// src/editor/index.ts (wire approve)
const approve = (i: number, approved: boolean) => {
  state = reduce(state, { type: "approve", sceneIndex: i, approved });
  void saveState(stateFile, state);
  sse.publish({ type: "state", state });
};
// pass `approve` to startServer
```

Update `ServerOpts` to include `approve`.

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/integration/editor-server.test.ts -t approve
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/api.ts src/editor/server.ts src/editor/index.ts tests/integration/editor-server.test.ts
git commit -m "feat(editor): POST /api/approve"
```

---

### Task 12: POST /api/script/:n (inline caption rewrite)

**Files:**
- Modify: `src/editor/api.ts`, `src/editor/server.ts`, `src/editor/index.ts`
- Test: extend `tests/integration/editor-server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("POST /api/script/:n", () => {
  it("rewrites prose in the .demo file", async () => {
    const r = await fetch(`${h.url}/api/script/0`, {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({ prose: "edited prose" }),
    });
    expect(r.ok).toBe(true);
    const text = await fs.readFile(demoFile, "utf8");
    expect(text).toContain("edited prose");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/integration/editor-server.test.ts -t script
```
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/api.ts (add)
export interface ScriptCtx extends ApiCtx { rewriteProse(sceneIndex: number, prose: string): Promise<void>; }
export async function handleScript(ctx: ScriptCtx, sceneIndex: number, body: { prose: string }, res: ServerResponse): Promise<void> {
  try {
    await ctx.rewriteProse(sceneIndex, body.prose);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
```

```ts
// src/editor/index.ts (add)
import { rewriteSceneProse } from "./script-rewrite.js";
const rewriteProse = async (i: number, prose: string) => {
  const src = await fs.readFile(demoFile, "utf8");
  const next = rewriteSceneProse(src, i, prose);
  await fs.writeFile(demoFile, next);
  ast = await readAst();
  // do NOT mark scene-changed — inline edits are user-driven; capture invalidation handled separately when needed
};
```

Wire to `startServer({ ..., rewriteProse })` and add a `/api/script/:n` route in `server.ts`.

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/integration/editor-server.test.ts -t script
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/api.ts src/editor/server.ts src/editor/index.ts tests/integration/editor-server.test.ts
git commit -m "feat(editor): POST /api/script rewrites a scene's prose"
```

---

### Task 13: POST /api/stitch (gated)

**Files:**
- Modify: `src/editor/api.ts`, `src/editor/server.ts`, `src/editor/index.ts`
- Test: extend integration test (gating only — full stitch covered by Task 3's test).

- [ ] **Step 1: Write the failing test**

```ts
describe("POST /api/stitch", () => {
  it("returns 409 when not all scenes approved", async () => {
    const r = await fetch(`${h.url}/api/stitch`, { method: "POST" });
    expect(r.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/integration/editor-server.test.ts -t stitch
```
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/editor/api.ts (add)
export interface StitchCtx extends ApiCtx { stitchNow(): Promise<string>; allApproved(): boolean; }
export async function handleStitch(ctx: StitchCtx, res: ServerResponse): Promise<void> {
  if (!ctx.allApproved()) {
    res.writeHead(409, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "not all scenes approved" })) as any;
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

Wire `stitchNow` in `index.ts`:

```ts
import { stitch } from "./stitch.js";

const stitchNow = async () => {
  const scenePaths = state.scenes.map((r) => r.webmPath!).filter(Boolean);
  const baseDir = path.dirname(demoFile);
  const music = ast.frontmatter.music ? path.resolve(baseDir, ast.frontmatter.music) : null;
  const out = path.join(baseDir, "output.mp4");
  await stitch({ scenePaths, music, output: out, workDir: dotDir, onLine: (l) => sse.publish({ type: "stitch-progress", line: l }) });
  sse.publish({ type: "stitch-done", output: out });
  return out;
};
```

Add route in `server.ts` and pass `stitchNow` + `allApproved` (already in state).

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/integration/editor-server.test.ts -t stitch
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/api.ts src/editor/server.ts src/editor/index.ts tests/integration/editor-server.test.ts
git commit -m "feat(editor): POST /api/stitch gated on all-approved"
```

---

### Task 14: Wire watcher into editor

**Files:**
- Modify: `src/editor/index.ts`

- [ ] **Step 1: Write implementation**

```ts
// in src/editor/index.ts startEditor, after readAst is defined:
import { Watcher } from "./watcher.js";

const watcher = new Watcher({
  paths: [demoFile],
  debounceMs: 100,
  onChange: async () => {
    const newAst = await readAst();
    // diff: any scene whose source line or content changed → mark scene-changed
    for (let i = 0; i < state.scenes.length; i++) {
      const oldRow = state.scenes[i];
      const newScene = newAst.scenes[i];
      if (!newScene || newScene.sourceLine !== oldRow.sourceLine || newScene.prose !== oldRow.prose || newScene.title !== oldRow.title) {
        state = reduce(state, { type: "scene-changed", sceneIndex: i });
      }
    }
    if (newAst.scenes.length !== state.scenes.length) {
      state = reduce(state, { type: "scenes-replaced", scenes: newAst.scenes });
    }
    ast = newAst;
    void saveState(stateFile, state);
    sse.publish({ type: "demo-changed" });
    sse.publish({ type: "state", state });
  },
});
await watcher.start();

// in rewriteProse: watcher.suppressNext() before writing the file
const rewriteProseImpl = async (i: number, prose: string) => {
  const src = await fs.readFile(demoFile, "utf8");
  const next = rewriteSceneProse(src, i, prose);
  watcher.suppressNext();
  await fs.writeFile(demoFile, next);
  ast = await readAst();
};

// in stop: await watcher.stop()
```

- [ ] **Step 2: No new test (covered by `tests/unit/watcher.test.ts` and existing integration). Run full test suite.**

```
npx vitest run
```
Expected: PASS.

- [ ] **Step 3: Commit**

```
git add src/editor/index.ts
git commit -m "feat(editor): file watcher refreshes state on .demo edits"
```

---

### Task 15: Static asset serving for the UI bundle

**Files:**
- Modify: `src/editor/server.ts`
- Test: extend `tests/integration/editor-server.test.ts` (serve a placeholder index.html from a tmp dir).

- [ ] **Step 1: Write the failing test**

```ts
describe("static UI", () => {
  it("serves index.html at /", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-static-"));
    await fs.writeFile(path.join(tmp, "index.html"), "<html>hi</html>");
    const file = path.join(tmp, "demo.demo");
    await fs.writeFile(file, `---\ntitle: T\nurl: http://x\n---\n\n# A\n\np\n`);
    const h3 = await startEditor({ demoFile: file, port: 0, uiDir: tmp });
    try {
      const r = await fetch(`${h3.url}/`);
      expect(await r.text()).toContain("<html>hi</html>");
    } finally { await h3.stop(); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/integration/editor-server.test.ts -t static
```
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `server.ts` route handling, after the API checks fall through:

```ts
import fs from "node:fs/promises";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".webm": "video/webm", ".mp4": "video/mp4",
  ".json": "application/json", ".png": "image/png",
};

async function serveStatic(uiDir: string, urlPath: string, res: ServerResponse): Promise<void> {
  const filePath = path.normalize(path.join(uiDir, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(uiDir)) { res.writeHead(403); return res.end(); }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    // SPA fallback: serve index.html for unknown HTML routes
    if (urlPath.endsWith(".html") || !path.extname(urlPath)) {
      try {
        const data = await fs.readFile(path.join(uiDir, "index.html"));
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(data) as any;
      } catch {}
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}
```

Add `uiDir?: string` to `ServerOpts`. After all `/api/*` checks fall through:

```ts
if (opts.uiDir) return serveStatic(opts.uiDir, url.pathname, res);
notFound(res);
```

Add captures dir static serving so `<video src="/captures/scene-001.webm">` works:

```ts
if (url.pathname.startsWith("/captures/")) {
  return serveStatic(path.dirname(opts.statePath), url.pathname, res); // or pass capturesDir explicitly
}
```

> Concrete: pass `capturesDir` to `startServer` and add a separate static serve for `/captures/`.

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/integration/editor-server.test.ts -t static
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/editor/server.ts src/editor/index.ts tests/integration/editor-server.test.ts
git commit -m "feat(editor): serve UI bundle and captures via static handler"
```

---

## Milestone 7 — CLI

### Task 16: `daymo edit` subcommand

**Files:**
- Create: `src/commands/edit.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write implementation**

```ts
// src/commands/edit.ts
import path from "node:path";
import { startEditor } from "../editor/index.js";
import { execa } from "execa";
import url from "node:url";

export async function editCommand(file: string, opts: { port?: number; noOpen?: boolean } = {}): Promise<void> {
  const demoFile = path.resolve(file);
  const uiDir = path.resolve(url.fileURLToPath(new URL("../editor-ui", import.meta.url)));
  const h = await startEditor({ demoFile, port: opts.port ?? 0, uiDir });
  console.log(`daymo edit: ${h.url}`);
  if (!opts.noOpen) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    void execa(opener, [h.url]).catch(() => {});
  }
  await new Promise<void>((resolve) => process.on("SIGINT", () => resolve()));
  await h.stop();
}
```

```ts
// src/cli.ts (add)
import { editCommand } from "./commands/edit.js";
cli.command("edit <file>", "Open the visual editor for a .demo file")
  .option("--port <n>", "Port to bind on localhost", { default: 0 })
  .option("--no-open", "Do not open a browser tab")
  .action((file: string, flags: { port: number; noOpen: boolean }) =>
    editCommand(file, { port: flags.port, noOpen: flags.noOpen }),
  );
```

> The `uiDir` resolves to `dist/editor-ui` at runtime (since `cli.ts` becomes `dist/cli.js`). Adjust path: `path.resolve(url.fileURLToPath(new URL("./editor-ui", import.meta.url)))` after build the layout is `dist/cli.js` next to `dist/editor-ui/index.html`. Use that.

- [ ] **Step 2: Manual smoke**

```
npm run build
node dist/cli.js edit tests/fixtures/demos/smoke.demo --no-open --port 12345
curl -s http://localhost:12345/api/state | head -c 200
# Ctrl-C to stop
```
Expected: JSON state printed.

- [ ] **Step 3: Commit**

```
git add src/commands/edit.ts src/cli.ts
git commit -m "feat(cli): daymo edit subcommand"
```

---

## Milestone 8 — UI scaffold

### Task 17: Vite + React + Tailwind project init

**Files:**
- Create: `editor-ui/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `tailwind.config.ts`, `postcss.config.js`, `src/index.css`, `src/main.tsx`, `src/App.tsx`
- Modify: root `package.json`, `tsconfig.json`, `.gitignore`

- [ ] **Step 1: Update root .gitignore**

Append:
```
editor-ui/dist/
editor-ui/node_modules/
```

- [ ] **Step 2: Create the Vite project**

`editor-ui/package.json`:
```json
{
  "name": "daymo-editor-ui",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^5.0.2",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.5",
    "class-variance-authority": "^0.7.1",
    "@radix-ui/react-tabs": "^1.1.2",
    "@radix-ui/react-slot": "^1.1.1",
    "lucide-react": "^0.469.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.3",
    "vite": "^6.0.7",
    "tailwindcss": "^3.4.17",
    "postcss": "^8.4.49",
    "autoprefixer": "^10.4.20"
  }
}
```

`editor-ui/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../dist/editor-ui", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:12345", "/captures": "http://localhost:12345" } },
});
```

`editor-ui/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`editor-ui/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "tailwind.config.ts"]
}
```

`editor-ui/index.html`:
```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Daymo</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`editor-ui/tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: "#6aa9ff",
        warn: "#ffa84a",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

`editor-ui/postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`editor-ui/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`editor-ui/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
```

`editor-ui/src/App.tsx`:
```tsx
export function App() {
  return <div className="p-6 text-zinc-100">Daymo editor — booting…</div>;
}
```

- [ ] **Step 3: Install + build**

```
cd editor-ui && npm install
npm run build
ls ../dist/editor-ui/index.html
```
Expected: a built `dist/editor-ui/index.html` exists.

- [ ] **Step 4: Wire root build to also build UI**

Update root `package.json` scripts:
```json
"scripts": {
  "build": "tsc && cd editor-ui && npm install && npm run build",
  "test": "vitest run",
  "test:watch": "vitest",
  "prepublishOnly": "npm run build"
}
```

- [ ] **Step 5: Commit**

```
git add editor-ui/ .gitignore package.json package-lock.json
git commit -m "feat(editor-ui): vite + react + tailwind scaffold"
```

---

### Task 18: shadcn/ui components — add `button`, `tabs`, `badge`, `textarea`

> shadcn/ui CLI is interactive. Vendor the components manually instead.

**Files:**
- Create: `editor-ui/src/lib/utils.ts`, `editor-ui/src/components/ui/button.tsx`, `tabs.tsx`, `badge.tsx`, `textarea.tsx`

- [ ] **Step 1: Create lib/utils**

```ts
// editor-ui/src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }
```

- [ ] **Step 2: Create button**

```tsx
// editor-ui/src/components/ui/button.tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-zinc-950 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-zinc-950 hover:bg-accent/90",
        ghost: "hover:bg-zinc-800 hover:text-zinc-100",
        outline: "border border-zinc-800 bg-transparent hover:bg-zinc-900",
      },
      size: { default: "h-9 px-4 py-2", sm: "h-8 px-3", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";
```

- [ ] **Step 3: Create tabs**

```tsx
// editor-ui/src/components/ui/tabs.tsx
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../../lib/utils";

export const Tabs = TabsPrimitive.Root;
export const TabsList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...p }, ref) => <TabsPrimitive.List ref={ref} className={cn("inline-flex h-9 items-center justify-start border-b border-zinc-800", className)} {...p} />,
);
TabsList.displayName = "TabsList";
export const TabsTrigger = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...p }, ref) => <TabsPrimitive.Trigger ref={ref} className={cn("inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-xs opacity-60 data-[state=active]:opacity-100 data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:font-semibold", className)} {...p} />,
);
TabsTrigger.displayName = "TabsTrigger";
export const TabsContent = TabsPrimitive.Content;
```

- [ ] **Step 4: Create badge + textarea**

```tsx
// editor-ui/src/components/ui/badge.tsx
import * as React from "react";
import { cn } from "../../lib/utils";
export function Badge({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center rounded-full border border-zinc-800 px-2 py-0.5 text-xs", className)} {...p} />;
}
```

```tsx
// editor-ui/src/components/ui/textarea.tsx
import * as React from "react";
import { cn } from "../../lib/utils";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => (
    <textarea ref={ref} className={cn("flex min-h-[60px] w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400", className)} {...p} />
  ),
);
Textarea.displayName = "Textarea";
```

- [ ] **Step 5: Commit**

```
git add editor-ui/src/components/ui editor-ui/src/lib/utils.ts
git commit -m "feat(editor-ui): vendored shadcn/ui primitives (button, tabs, badge, textarea)"
```

---

## Milestone 9 — UI components

### Task 19: API client + SSE hook + store

**Files:**
- Create: `editor-ui/src/lib/api.ts`, `editor-ui/src/lib/sse.ts`, `editor-ui/src/lib/types.ts`, `editor-ui/src/store.ts`

- [ ] **Step 1: Write the implementation**

```ts
// editor-ui/src/lib/types.ts
export type SceneState = "pending" | "captured" | "approved";
export interface OverlayDirective { type: "callout"|"highlight"; target?: string; text?: string; duration?: string; [k: string]: unknown; }
export interface SceneRow {
  sourceLine: number; title: string; prose: string; overlays: OverlayDirective[];
  state: SceneState; webmPath?: string; eventsPath?: string; capturedAt?: number; errorMessage?: string;
}
export interface EditorState { demoFile: string; scenes: SceneRow[]; allApproved: boolean; }
```

```ts
// editor-ui/src/lib/api.ts
import type { EditorState } from "./types";

async function jsonOrThrow<T>(p: Promise<Response>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}
export const api = {
  state: (): Promise<EditorState> => jsonOrThrow(fetch("/api/state")),
  capture: (i: number) => jsonOrThrow(fetch(`/api/capture/${i}`, { method: "POST" })),
  approve: (i: number, approved: boolean) =>
    jsonOrThrow(fetch(`/api/approve/${i}`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ approved }) })),
  setProse: (i: number, prose: string) =>
    jsonOrThrow(fetch(`/api/script/${i}`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ prose }) })),
  stitch: () => jsonOrThrow<{ output: string }>(fetch("/api/stitch", { method: "POST" })),
};
```

```ts
// editor-ui/src/lib/sse.ts
import { useEffect } from "react";
export function useSse(onEvent: (evt: any) => void): void {
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
    return () => es.close();
  }, [onEvent]);
}
```

```ts
// editor-ui/src/store.ts
import { create } from "zustand";
import type { EditorState, SceneRow } from "./lib/types";

export interface Draft { id: string; sceneIndex: number; targetKind: "caption" | "overlay"; targetIndex?: number; text: string; }

interface UiStore {
  state: EditorState | null;
  selectedSceneIndex: number | null;
  drafts: Draft[];
  setState: (s: EditorState) => void;
  patchScene: (i: number, patch: Partial<SceneRow>) => void;
  setSelected: (i: number | null) => void;
  addDraft: (d: Omit<Draft, "id">) => void;
  removeDraft: (id: string) => void;
  clearDrafts: () => void;
}
export const useUi = create<UiStore>((set) => ({
  state: null,
  selectedSceneIndex: null,
  drafts: [],
  setState: (s) => set({ state: s }),
  patchScene: (i, patch) => set((u) => {
    if (!u.state) return u;
    const scenes = u.state.scenes.map((row, idx) => idx === i ? { ...row, ...patch } : row);
    return { state: { ...u.state, scenes, allApproved: scenes.every((r) => r.state === "approved") } };
  }),
  setSelected: (i) => set({ selectedSceneIndex: i }),
  addDraft: (d) => set((u) => ({ drafts: [...u.drafts, { ...d, id: Math.random().toString(36).slice(2) }] })),
  removeDraft: (id) => set((u) => ({ drafts: u.drafts.filter((x) => x.id !== id) })),
  clearDrafts: () => set({ drafts: [] }),
}));
```

- [ ] **Step 2: Commit**

```
git add editor-ui/src
git commit -m "feat(editor-ui): api client + sse hook + zustand store"
```

---

### Task 20: Rail + Preview + App layout

**Files:**
- Modify: `editor-ui/src/App.tsx`
- Create: `editor-ui/src/components/Rail.tsx`, `Preview.tsx`

- [ ] **Step 1: Write the implementation**

```tsx
// editor-ui/src/components/Rail.tsx
import { Badge } from "./ui/badge";
import { useUi } from "../store";
import { api } from "../lib/api";

export function Rail() {
  const { state, selectedSceneIndex, setSelected, drafts } = useUi();
  if (!state) return <div className="p-3 text-xs opacity-60">loading…</div>;
  return (
    <div className="flex flex-col gap-2 p-3 overflow-auto">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] tracking-wide uppercase opacity-60">Scenes · {state.scenes.length}</div>
        <button className="text-xs opacity-70 hover:opacity-100" onClick={() => state.scenes.forEach((_, i) => api.capture(i))}>Capture all</button>
      </div>
      {state.scenes.map((r, i) => {
        const draftCount = drafts.filter((d) => d.sceneIndex === i).length;
        const selected = selectedSceneIndex === i;
        return (
          <div key={i}
            onClick={() => setSelected(i)}
            className={"cursor-pointer p-2 rounded text-xs " + (selected ? "bg-accent/40 outline outline-1 outline-accent" : "hover:bg-zinc-900")}>
            <div className="flex justify-between font-semibold"><span>{i + 1}. {r.title}</span></div>
            <div className="opacity-70 text-[10px] mt-0.5 flex gap-1.5">
              {r.state === "pending" && <span>⊘ pending</span>}
              {r.state === "captured" && <span>🎬 captured</span>}
              {r.state === "approved" && <span>✓ approved</span>}
              {draftCount > 0 && <Badge className="text-warn border-warn/40">💬 {draftCount} draft</Badge>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

```tsx
// editor-ui/src/components/Preview.tsx
import { useUi } from "../store";
import { api } from "../lib/api";
import { Button } from "./ui/button";

export function Preview() {
  const { state, selectedSceneIndex, patchScene } = useUi();
  if (!state || selectedSceneIndex === null) return <div className="p-6 opacity-60 text-sm">Select a scene from the rail.</div>;
  const row = state.scenes[selectedSceneIndex];
  const src = row.webmPath ? `/captures/${row.webmPath.split("/").pop()}` : null;
  return (
    <div className="p-3 border-b border-zinc-800 flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <div className="font-semibold">Scene {selectedSceneIndex + 1} · {row.title}</div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => api.capture(selectedSceneIndex)}>{src ? "Re-capture" : "Capture"}</Button>
          {row.state !== "pending" && (
            <Button size="sm" onClick={async () => { await api.approve(selectedSceneIndex, row.state !== "approved"); patchScene(selectedSceneIndex, { state: row.state === "approved" ? "captured" : "approved" }); }}>
              {row.state === "approved" ? "Unapprove" : "✓ Approve"}
            </Button>
          )}
        </div>
      </div>
      <div className="aspect-video bg-zinc-900 rounded flex items-center justify-center">
        {src ? <video controls src={src} className="max-h-full" /> : <span className="text-xs opacity-60">No capture yet — click Capture above.</span>}
      </div>
    </div>
  );
}
```

```tsx
// editor-ui/src/App.tsx
import { useEffect } from "react";
import { useUi } from "./store";
import { useSse } from "./lib/sse";
import { api } from "./lib/api";
import { Rail } from "./components/Rail";
import { Preview } from "./components/Preview";

export function App() {
  const { setState, patchScene } = useUi();
  useEffect(() => { api.state().then(setState).catch(console.error); }, [setState]);
  useSse((evt) => {
    if (evt.type === "state") setState(evt.state);
    if (evt.type === "capture-done") patchScene(evt.sceneIndex, { state: "captured", webmPath: evt.webmPath });
    if (evt.type === "demo-changed") api.state().then(setState);
  });
  return (
    <div className="h-screen flex">
      <div className="w-[30%] border-r border-zinc-800 overflow-auto">
        <Rail />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <Preview />
        {/* Tabs go here in Task 21 */}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

```
cd editor-ui && npm run build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```
git add editor-ui/src
git commit -m "feat(editor-ui): app shell with rail + preview"
```

---

### Task 21: Tabs (Script + Overlays + Errors)

**Files:**
- Create: `editor-ui/src/components/Tabs.tsx`, `Script.tsx`, `Overlays.tsx`, `Errors.tsx`
- Modify: `editor-ui/src/App.tsx`

- [ ] **Step 1: Write the implementation**

```tsx
// editor-ui/src/components/Script.tsx
import { useUi } from "../store";
import { api } from "../lib/api";

export function Script() {
  const { state, selectedSceneIndex, patchScene } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];

  const onBlur = async (e: React.FocusEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText.trim();
    if (text === row.prose) return;
    await api.setProse(selectedSceneIndex, text);
    patchScene(selectedSceneIndex, { prose: text });
  };

  return (
    <div className="p-3 text-xs">
      <div className="opacity-60 text-[10px] uppercase tracking-wide mb-1">Caption · click to edit</div>
      <div contentEditable suppressContentEditableWarning className="p-2 rounded bg-zinc-900 outline-none focus:ring-1 focus:ring-zinc-500" onBlur={onBlur}>
        {row.prose}
      </div>
    </div>
  );
}
```

```tsx
// editor-ui/src/components/Overlays.tsx
import { useUi } from "../store";
export function Overlays() {
  const { state, selectedSceneIndex } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  return (
    <div className="p-3 text-xs flex flex-col gap-2">
      {row.overlays.map((o, i) => (
        <div key={i} className="bg-zinc-900 rounded p-2">
          <div className="opacity-60 text-[10px] uppercase">Overlay · {o.type}</div>
          {o.target && <div>target: <code>{o.target}</code></div>}
          {o.text && <div>text: {o.text}</div>}
          {o.duration && <div>duration: {o.duration}</div>}
        </div>
      ))}
    </div>
  );
}
```

```tsx
// editor-ui/src/components/Errors.tsx
import { useUi } from "../store";
export function Errors() {
  const { state, selectedSceneIndex } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  if (!row.errorMessage) return null;
  return <div className="p-3 text-xs text-red-400">{row.errorMessage}</div>;
}
```

```tsx
// editor-ui/src/components/Tabs.tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Script } from "./Script";
import { Overlays } from "./Overlays";
import { Errors } from "./Errors";
import { useUi } from "../store";

export function SceneTabs() {
  const { state, selectedSceneIndex } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  const showOverlays = row.overlays.length > 0;
  const showErrors = !!row.errorMessage;
  return (
    <Tabs defaultValue="script" className="flex-1 overflow-auto">
      <TabsList className="px-3">
        <TabsTrigger value="script">Script</TabsTrigger>
        {showOverlays && <TabsTrigger value="overlays">Overlays · {row.overlays.length}</TabsTrigger>}
        {showErrors && <TabsTrigger value="errors">Errors</TabsTrigger>}
      </TabsList>
      <TabsContent value="script"><Script /></TabsContent>
      {showOverlays && <TabsContent value="overlays"><Overlays /></TabsContent>}
      {showErrors && <TabsContent value="errors"><Errors /></TabsContent>}
    </Tabs>
  );
}
```

In `App.tsx` add `<SceneTabs />` below `<Preview />`.

- [ ] **Step 2: Build**

```
cd editor-ui && npm run build
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```
git add editor-ui/src
git commit -m "feat(editor-ui): tabs (script/overlays/errors), only-show-what-exists"
```

---

### Task 22: Composer (+ comment, draft cards)

**Files:**
- Create: `editor-ui/src/components/Composer.tsx`
- Modify: `Script.tsx`, `Overlays.tsx` (add `+ comment` button under each block)

- [ ] **Step 1: Write the Composer**

```tsx
// editor-ui/src/components/Composer.tsx
import { useState } from "react";
import { useUi } from "../store";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";

export function ComposerInline({ sceneIndex, target }: { sceneIndex: number; target: { kind: "caption" } | { kind: "overlay"; index: number } }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const addDraft = useUi((s) => s.addDraft);
  if (!open) return <button className="text-[11px] text-accent" onClick={() => setOpen(true)}>+ comment</button>;
  return (
    <div className="bg-warn/10 border-l-2 border-warn rounded p-2 mt-1.5 flex flex-col gap-2">
      <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should change?" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setText(""); }}>Cancel</Button>
        <Button size="sm" onClick={() => {
          if (!text.trim()) return;
          addDraft({ sceneIndex, targetKind: target.kind, targetIndex: target.kind === "overlay" ? target.index : undefined, text: text.trim() });
          setText(""); setOpen(false);
        }}>Add draft</Button>
      </div>
    </div>
  );
}

export function DraftList({ sceneIndex }: { sceneIndex: number }) {
  const { drafts, removeDraft } = useUi();
  const here = drafts.filter((d) => d.sceneIndex === sceneIndex);
  if (here.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-2">
      {here.map((d) => (
        <div key={d.id} className="bg-warn/10 border-l-2 border-warn rounded p-2 text-xs">
          <div className="flex justify-between text-[10px] opacity-70 mb-1">
            <span>💬 DRAFT · scene {d.sceneIndex + 1} · {d.targetKind}{d.targetIndex !== undefined ? ` ${d.targetIndex + 1}` : ""}</span>
            <button onClick={() => removeDraft(d.id)}>×</button>
          </div>
          {d.text}
        </div>
      ))}
    </div>
  );
}
```

In `Script.tsx`, after the editable div, add:
```tsx
import { ComposerInline, DraftList } from "./Composer";
// inside Script:
<ComposerInline sceneIndex={selectedSceneIndex} target={{ kind: "caption" }} />
<DraftList sceneIndex={selectedSceneIndex} />
```

In `Overlays.tsx`, inside each overlay block:
```tsx
<ComposerInline sceneIndex={selectedSceneIndex} target={{ kind: "overlay", index: i }} />
```

- [ ] **Step 2: Build**

```
cd editor-ui && npm run build
```
Expected: succeeds.

- [ ] **Step 3: Commit**

```
git add editor-ui/src
git commit -m "feat(editor-ui): + comment composer + draft list"
```

---

### Task 23: ReviewBar with batched-prompt formatter + clipboard

**Files:**
- Create: `src/editor/prompt.ts` (canonical), `editor-ui/src/lib/prompt.ts` (UI copy), `editor-ui/src/components/ReviewBar.tsx`
- Modify: `App.tsx` (mount ReviewBar at top-right)
- Test: `tests/unit/prompt-format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/prompt-format.test.ts
import { describe, it, expect } from "vitest";
import { formatReviewPrompt } from "../../src/editor/prompt.js";

const state: any = {
  demoFile: "/p/demo.demo",
  scenes: [
    { sourceLine: 1, title: "Welcome", prose: "Old prose.", overlays: [{ type: "callout", target: "[data-x]", text: "click here", duration: "2s" }], state: "captured" },
    { sourceLine: 9, title: "Two", prose: "Second.", overlays: [], state: "captured" },
  ],
};

describe("formatReviewPrompt", () => {
  it("includes only scenes referenced by drafts; quotes prose; renders overlay yaml", () => {
    const md = formatReviewPrompt(state, [
      { id: "1", sceneIndex: 0, targetKind: "caption", text: "shorten" },
      { id: "2", sceneIndex: 0, targetKind: "overlay", targetIndex: 0, text: "rewrite friendlier" },
    ]);
    expect(md).toContain("`/p/demo.demo`");
    expect(md).toContain("# Comment 1 — Scene 1 (caption)");
    expect(md).toContain("> Old prose.");
    expect(md).toContain("> shorten");
    expect(md).toContain("# Comment 2 — Scene 1 (overlay)");
    expect(md).toContain("type: callout");
    expect(md).not.toContain("# Comment 3");
    expect(md).not.toContain("Scene 2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/unit/prompt-format.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Write canonical implementation**

```ts
// src/editor/prompt.ts
import type { EditorState } from "./types.js";

export interface DraftLike {
  id: string;
  sceneIndex: number;
  targetKind: "caption" | "overlay";
  targetIndex?: number;
  text: string;
}

export function formatReviewPrompt(state: EditorState, drafts: DraftLike[]): string {
  const lines: string[] = [];
  lines.push(`You're editing \`${state.demoFile}\`. The user has left these review comments —`);
  lines.push(`please apply them as a single edit. Do NOT touch scenes that are not mentioned.`);
  lines.push(`After editing, do not run capture; the editor will handle that.`);
  lines.push("");
  drafts.forEach((d, i) => {
    const row = state.scenes[d.sceneIndex];
    lines.push(`# Comment ${i + 1} — Scene ${d.sceneIndex + 1} (${d.targetKind})`);
    lines.push("");
    if (d.targetKind === "caption") {
      lines.push("Current text:");
      for (const ln of row.prose.split("\n")) lines.push(`> ${ln}`);
    } else {
      const ov = row.overlays[d.targetIndex ?? 0];
      lines.push("Current overlay:");
      lines.push("```yaml");
      lines.push(`type: ${ov.type}`);
      if (ov.target) lines.push(`target: "${ov.target}"`);
      if (ov.text) lines.push(`text: "${ov.text}"`);
      if (ov.duration) lines.push(`duration: ${ov.duration}`);
      lines.push("```");
    }
    lines.push("");
    lines.push("User comment:");
    for (const ln of d.text.split("\n")) lines.push(`> ${ln}`);
    lines.push("");
  });
  return lines.join("\n");
}
```

- [ ] **Step 4: Copy canonical into the UI**

```ts
// editor-ui/src/lib/prompt.ts
// SYNC: keep this file identical to src/editor/prompt.ts
import type { EditorState } from "./types";
export interface DraftLike { id: string; sceneIndex: number; targetKind: "caption" | "overlay"; targetIndex?: number; text: string; }
export function formatReviewPrompt(state: EditorState, drafts: DraftLike[]): string {
  // … paste body from src/editor/prompt.ts unchanged …
}
```

(Paste the same body. The dual file is a known wart, called out in the spec.)

- [ ] **Step 5: Write the ReviewBar**

```tsx
// editor-ui/src/components/ReviewBar.tsx
import { useUi } from "../store";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatReviewPrompt } from "../lib/prompt";

export function ReviewBar() {
  const { state, drafts, clearDrafts } = useUi();
  if (!state) return null;
  const submit = async () => {
    const md = formatReviewPrompt(state, drafts);
    await navigator.clipboard.writeText(md);
    clearDrafts();
    // toast
    const t = document.createElement("div");
    t.textContent = "Copied — paste into Claude Code";
    t.className = "fixed bottom-4 right-4 bg-accent/30 text-zinc-100 text-xs px-3 py-2 rounded";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  };
  return (
    <div className="flex items-center gap-2">
      {drafts.length > 0 && <Badge className="border-warn/40 text-warn">{drafts.length} drafts</Badge>}
      <Button size="sm" disabled={drafts.length === 0} onClick={submit}>Submit review ⏎</Button>
    </div>
  );
}
```

In `App.tsx`, add a top bar:
```tsx
import { ReviewBar } from "./components/ReviewBar";
// inside the right pane, above Preview, render a small header:
<div className="px-3 py-2 border-b border-zinc-800 flex justify-end"><ReviewBar /></div>
```

- [ ] **Step 6: Run test to verify it passes**

```
npx vitest run tests/unit/prompt-format.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```
git add src/editor/prompt.ts editor-ui/src tests/unit/prompt-format.test.ts
git commit -m "feat(editor): batched review prompt + clipboard submit"
```

---

### Task 24: StitchBar

**Files:**
- Create: `editor-ui/src/components/StitchBar.tsx`
- Modify: `App.tsx`, `Rail.tsx` (footer)

- [ ] **Step 1: Write the implementation**

```tsx
// editor-ui/src/components/StitchBar.tsx
import { useState } from "react";
import { useUi } from "../store";
import { api } from "../lib/api";
import { Button } from "./ui/button";

export function StitchBar() {
  const { state } = useUi();
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  if (!state) return null;
  const ok = state.allApproved;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] opacity-60">{state.scenes.filter((r) => r.state === "captured" || r.state === "approved").length}/{state.scenes.length} captured · {state.scenes.filter((r) => r.state === "approved").length} approved</span>
      <Button size="sm" disabled={!ok || busy} onClick={async () => { setBusy(true); try { const r = await api.stitch(); setOutput(r.output); } finally { setBusy(false); } }}>
        {busy ? "Stitching…" : "Stitch ⏵"}
      </Button>
      {output && <span className="text-[10px] opacity-60">→ {output}</span>}
    </div>
  );
}
```

In `Rail.tsx` add a footer:
```tsx
import { StitchBar } from "./StitchBar";
// at the bottom of the rail container:
<div className="mt-auto pt-2 border-t border-zinc-800"><StitchBar /></div>
```

- [ ] **Step 2: Build + commit**

```
cd editor-ui && npm run build
git add editor-ui/src
git commit -m "feat(editor-ui): stitch bar (gated)"
```

---

## Milestone 10 — End-to-end smoke

### Task 25: E2E smoke test

**Files:**
- Create: `tests/e2e/edit-smoke.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/e2e/edit-smoke.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { startSampleApp, stopSampleApp } from "../integration/server.js";
import { startEditor, type EditorHandle } from "../../src/editor/index.js";

let appUrl: string;
let h: EditorHandle;
let demoFile: string;
beforeAll(async () => { appUrl = await startSampleApp(); }, 30_000);
afterAll(async () => { await stopSampleApp(); await h?.stop(); });

describe("daymo edit smoke", () => {
  it("captures one scene, approves it, sees state.json reflect approval", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-e2e-"));
    demoFile = path.join(tmp, "demo.demo");
    await fs.writeFile(demoFile, `---
title: T
url: ${appUrl}
---

# A

prose
`);
    h = await startEditor({ demoFile, port: 0 });

    // capture
    const r = await fetch(`${h.url}/api/capture/0`, { method: "POST" });
    expect(r.ok).toBe(true);
    // poll state
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const s = await (await fetch(`${h.url}/api/state`)).json();
      if (s.scenes[0].state === "captured") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const s = await (await fetch(`${h.url}/api/state`)).json();
    expect(s.scenes[0].state).toBe("captured");

    // approve
    await fetch(`${h.url}/api/approve/0`, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ approved: true }) });
    const s2 = await (await fetch(`${h.url}/api/state`)).json();
    expect(s2.allApproved).toBe(true);

    // state.json on disk
    await h.stop();
    const json = JSON.parse(await fs.readFile(path.join(tmp, ".daymo/state.json"), "utf8"));
    expect(json.scenes[0].state).toBe("approved");
  }, 60_000);
});
```

- [ ] **Step 2: Run + commit**

```
npx vitest run tests/e2e/edit-smoke.test.ts
```
Expected: PASS.

```
git add tests/e2e/edit-smoke.test.ts
git commit -m "test(e2e): daymo edit capture+approve+persist smoke"
```

---

## Self-review

**Spec coverage check:**
- ✅ `daymo edit` CLI subcommand → Task 16
- ✅ Localhost server, browser open → Task 9, 16
- ✅ Per-scene capture → Task 1, 10
- ✅ Stitch (concat + music) gated on all-approved → Task 2, 3, 13
- ✅ State machine (pending/captured/approved + invalidate on edit) → Task 4
- ✅ State persistence in `.daymo/state.json` → Task 5
- ✅ File watcher with debounce + sentinel → Task 7, 14
- ✅ Caption rewrite → Task 6, 12
- ✅ SSE → Task 8, 9
- ✅ UI: Vite + React + Tailwind + shadcn/ui → Task 17, 18
- ✅ Rail + Preview + Tabs (only-show-what-exists) → Task 20, 21
- ✅ Inline caption editing (contenteditable) → Task 21 (Script.tsx)
- ✅ + comment + draft list (PR-style) → Task 22
- ✅ Submit review → batched prompt + clipboard → Task 23
- ✅ Stitch button gated → Task 24
- ✅ E2E smoke → Task 25
- ✅ Static UI bundle served → Task 15

**Placeholder scan:** No "TBD"/"TODO" placeholders in steps. The `index.ts` consolidation in Task 10 is shown as a full file. The shadcn/ui vendor in Task 18 lists exact components. The dual prompt.ts is called out as deliberate.

**Type consistency:** `EditorState`, `SceneRow`, `StateAction` defined once in `src/editor/types.ts`, imported elsewhere. UI uses `editor-ui/src/lib/types.ts` as a duplicate — also called out. `formatReviewPrompt` signature consistent across canonical + UI copy.

**One known wart, deliberately accepted:** `prompt.ts` and `types.ts` are duplicated between server (`src/editor/`) and UI (`editor-ui/src/lib/`). The UI is a separate Vite project, so it cannot import directly from the server tsconfig's rootDir without restructuring into a workspace. A future task could replace duplication with a shared package.
