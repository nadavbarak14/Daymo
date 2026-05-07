// src/manifest.ts
import path from "node:path";
import fs from "node:fs/promises";
import type { CaptureMode, RunnerEvent, Scene } from "./types.js";

export interface ManifestSceneEntry {
  index: number;          // 0-based, dense
  title: string;
  slug: string;
  sourceLine: number;     // matches Scene.sourceLine for cross-ref
  tStartMs: number;
  tEndMs: number;
}

export type ManifestMarker =
  | { kind: "fast_forward"; sceneIndex: number; tStartMs: number; tEndMs: number; factor: number }
  | { kind: "skip";         sceneIndex: number; tStartMs: number; tEndMs: number };

export interface Manifest {
  version: 2;
  demoFile: string;
  captureMode: CaptureMode;
  viewport: { width: number; height: number };
  createdAt: string;
  scenes: ManifestSceneEntry[];
  markers: ManifestMarker[];
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface BuildManifestArgs {
  demoFile: string;
  captureMode: CaptureMode;
  viewport: { width: number; height: number };
  scenes: Scene[];
  events: RunnerEvent[];
}

export function buildManifest(args: BuildManifestArgs): Manifest {
  const sourceLineToIndex = new Map(args.scenes.map((s, i) => [s.sourceLine, i] as const));

  const sceneEntries: ManifestSceneEntry[] = args.scenes.map((s, i) => ({
    index: i,
    title: s.title,
    slug: slugify(s.title),
    sourceLine: s.sourceLine,
    tStartMs: 0,
    tEndMs: 0,
  }));

  for (const ev of args.events) {
    if (ev.kind === "scene_start") {
      const i = sourceLineToIndex.get(ev.index);
      if (i !== undefined) sceneEntries[i].tStartMs = ev.t;
    } else if (ev.kind === "scene_end") {
      const i = sourceLineToIndex.get(ev.index);
      if (i !== undefined) sceneEntries[i].tEndMs = ev.t;
    }
  }

  const markers: ManifestMarker[] = [];
  let pendingFf: { tStart: number; sceneIndex: number; factor: number } | null = null;
  let pendingSkip: { tStart: number; sceneIndex: number } | null = null;

  for (const ev of args.events) {
    if (ev.kind === "fast_forward_start") {
      pendingFf = {
        tStart: ev.t,
        sceneIndex: sourceLineToIndex.get(ev.sceneIndex) ?? 0,
        factor: ev.factor,
      };
    } else if (ev.kind === "fast_forward_end" && pendingFf) {
      markers.push({
        kind: "fast_forward",
        sceneIndex: pendingFf.sceneIndex,
        tStartMs: pendingFf.tStart,
        tEndMs: ev.t,
        factor: pendingFf.factor,
      });
      pendingFf = null;
    } else if (ev.kind === "skip_start") {
      pendingSkip = {
        tStart: ev.t,
        sceneIndex: sourceLineToIndex.get(ev.sceneIndex) ?? 0,
      };
    } else if (ev.kind === "skip_end" && pendingSkip) {
      markers.push({
        kind: "skip",
        sceneIndex: pendingSkip.sceneIndex,
        tStartMs: pendingSkip.tStart,
        tEndMs: ev.t,
      });
      pendingSkip = null;
    }
  }

  return {
    version: 2,
    demoFile: args.demoFile,
    captureMode: args.captureMode,
    viewport: args.viewport,
    createdAt: new Date().toISOString(),
    scenes: sceneEntries,
    markers,
  };
}

export async function writeManifest(captureDir: string, m: Manifest): Promise<void> {
  await fs.writeFile(path.join(captureDir, "capture.json"), JSON.stringify(m, null, 2));
}

export async function readManifest(captureDir: string): Promise<Manifest> {
  const txt = await fs.readFile(path.join(captureDir, "capture.json"), "utf8");
  const m = JSON.parse(txt) as Manifest;
  if (m.version !== 2) throw new Error(`unsupported manifest version: ${m.version}`);
  return m;
}
