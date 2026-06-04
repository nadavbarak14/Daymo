# Daymo Self-Hosted Help — Publish Plan (Plan A2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `daymo publish` turns an already-indexed widget dir (`<dataRoot>/widgets/<id>/` from `daymo index`) into uploaded artifacts: a demos-only `manifest.json` (no embeddings), the `index.json`, and each demo's `output.mp4`/`output.vtt` — pushed through a pluggable `Uploader`.

**Architecture:** A pure `buildManifest(index)` (gallery data, never ships embeddings) + a `publish()` orchestrator that reads the widget dir and writes through an injected `Uploader` interface. The default `Uploader` writes to a local output directory (no new dependency); an S3/R2 uploader is a drop-in implementing the same interface (documented, not bundled). Reuses `IndexFile` from Plan A (`videoBaseUrl` already present).

**Tech Stack:** TypeScript (ESM), vitest, `cac` (existing CLI framework), Node `fs`.

**Spec:** `docs/superpowers/specs/2026-06-04-daymo-self-hosted-help-integration-design.md`

## File structure
- Create: `src/publish/types.ts` — `HelpManifest`, `ManifestDemo`, `ManifestStep`, `Uploader`.
- Create: `src/publish/manifest.ts` — `buildManifest(index, { version })` (pure).
- Create: `src/publish/dir-uploader.ts` — default local-directory `Uploader`.
- Create: `src/publish/publish.ts` — `publish(opts)` orchestration.
- Create: `src/commands/publish.ts` — CLI wiring.
- Modify: `src/cli.ts` — register `publish`.
- Tests: `tests/unit/publish/manifest.test.ts`, `tests/unit/publish/publish.test.ts`.

## Task 1: Manifest types + `buildManifest`
- [ ] Test (`tests/unit/publish/manifest.test.ts`): given an `IndexFile` with 1 demo + 2 chunks, `buildManifest` returns `demos[0].videoUrl === videoBaseUrl + "/d/output.mp4"`, `posterUrl` ends `/poster.jpg`, `steps` sorted by `startMs`, and the manifest contains **no `embedding` field anywhere** (`JSON.stringify(manifest)` excludes embeddings).
- [ ] Run → FAIL (module missing).
- [ ] Implement `src/publish/types.ts` + `src/publish/manifest.ts` (see code in implementation).
- [ ] Run → PASS. Commit.

## Task 2: `publish()` orchestration with injected uploader
- [ ] Test (`tests/unit/publish/publish.test.ts`): build a temp `dataRoot/widgets/help/` with `index.json` + `demos/d/output.mp4`; a fake `Uploader` records `put(key, …)`; assert `manifest.json`, `index.json`, and `d/output.mp4` were put, and `summary.videoCount === 1`.
- [ ] Run → FAIL.
- [ ] Implement `src/publish/dir-uploader.ts` + `src/publish/publish.ts`.
- [ ] Run → PASS. Commit.

## Task 3: `daymo publish` CLI command
- [ ] Implement `src/commands/publish.ts` (reads `--data-root`, `--widget-id`, `--version`, `--out`; default uploader = `createDirUploader(out)`), register in `src/cli.ts`.
- [ ] Build (`npx tsc`) and smoke: `node dist/cli.js publish --help` lists the command.
- [ ] Commit.

## Self-review
- Manifest never carries embeddings (Decision #10) — asserted in Task 1.
- `videoUrl`/`posterUrl` derive from `index.videoBaseUrl` (Plan A field).
- Uploader is injectable → S3/R2 is a drop-in; no heavy dependency added now.
