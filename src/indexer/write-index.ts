import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { parse } from "../parser.js";
import { buildChunks } from "./chunk-builder.js";
import { extractKeywords } from "./keywords.js";
import { embedBatch, DEFAULT_EMBEDDING_MODEL } from "./embedder-gemini.js";
import { pickSuggestedQuestions } from "./suggested-questions.js";
import type { RunnerEvent, StepIndex, IndexFile, IndexedChunk, IndexedDemo, WidgetConfig } from "../types.js";

export interface WriteIndexOpts {
  demoDir: string;
  widgetId: string;
  widgetName: string;
  locale: string;
  allowedOrigins: string[];
  brandColor?: string;
  dataRoot: string;
  geminiApiKey: string;
  embeddingModel?: string;
  videoBaseUrl?: string;
  fetchFn?: typeof fetch;
}

/** Find every `.demo` file under `dir`, recursively. Each demo keeps its own
 *  `.daymo/` + `output.mp4` in its own folder, so a folder-per-demo layout lets
 *  one `daymo index <dir>` build a whole widget without demos clobbering each
 *  other's working state. Top-level `.demo` files (single-demo dirs) still work. */
async function findDemoFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".daymo" || e.name === "node_modules" || e.name.startsWith(".")) continue;
      out.push(...(await findDemoFiles(full)));
    } else if (e.isFile() && e.name.endsWith(".demo")) {
      out.push(full);
    }
  }
  return out.sort();
}

export async function writeIndexForDemoDir(opts: WriteIndexOpts): Promise<void> {
  const demoFiles = await findDemoFiles(opts.demoDir);
  if (demoFiles.length === 0) {
    throw new Error(`no .demo files found in ${opts.demoDir}`);
  }

  const demos: IndexedDemo[] = [];
  const allChunks: IndexedChunk[] = [];
  const allStepDescriptions: string[] = [];
  // demoId → the demo's own directory, so we can copy its stitched video later.
  const demoBaseDirs = new Map<string, string>();

  for (const demoFile of demoFiles) {
    const demoId = path.basename(demoFile, path.extname(demoFile));
    const baseDir = path.dirname(demoFile);
    if (demoBaseDirs.has(demoId)) {
      throw new Error(`duplicate demo id "${demoId}" (${demoBaseDirs.get(demoId)} and ${baseDir}); give each .demo a unique filename`);
    }
    demoBaseDirs.set(demoId, baseDir);
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
        embedding: [],
        keywords: extractKeywords(c.text),
      });
    }
  }

  const embeddingModel = opts.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;
  const embeddings = await embedBatch(
    allChunks.map((c) => c.text),
    { apiKey: opts.geminiApiKey, model: embeddingModel, fetchFn: opts.fetchFn },
  );
  for (let i = 0; i < allChunks.length; i++) allChunks[i].embedding = embeddings[i];

  const embeddingDims = allChunks.length > 0 ? allChunks[0].embedding.length : 768;
  const createdAt = new Date().toISOString();
  const etag = computeEtag(allChunks, demos);

  const indexFile: IndexFile = {
    version: "v1",
    widgetId: opts.widgetId,
    embeddingModel,
    embeddingDims,
    videoBaseUrl: opts.videoBaseUrl ?? "",
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

  // Copy each demo's stitched video + captions into the widget dir, where
  // `daymo publish` reads them (`<widget>/demos/<demoId>/output.{mp4,vtt}`).
  // `daymo stitch` writes output.mp4 and captions.vtt into the demo's own dir.
  for (const [demoId, baseDir] of demoBaseDirs) {
    const destDir = path.join(widgetDir, "demos", demoId);
    await fs.mkdir(destDir, { recursive: true });
    try {
      await fs.copyFile(path.join(baseDir, "output.mp4"), path.join(destDir, "output.mp4"));
    } catch {
      // No video rendered yet — publish will report this demo's video missing.
    }
    try {
      await fs.copyFile(path.join(baseDir, "captions.vtt"), path.join(destDir, "output.vtt"));
    } catch {
      // Captions are optional.
    }
  }
}

function computeEtag(chunks: IndexedChunk[], demos: IndexedDemo[]): string {
  const h = crypto.createHash("sha256");
  for (const d of demos) h.update(`${d.demoId}\x00${d.durationMs}\x00`);
  for (const c of chunks) h.update(`${c.stepId}\x00${c.text}\x00`);
  return h.digest("hex");
}
