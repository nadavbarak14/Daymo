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
  demoDir: string;
  widgetId: string;
  widgetName: string;
  locale: string;
  allowedOrigins: string[];
  brandColor?: string;
  dataRoot: string;
  geminiApiKey: string;
  fetchFn?: typeof fetch;
}

export async function writeIndexForDemoDir(opts: WriteIndexOpts): Promise<void> {
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
        embedding: [],
        keywords: extractKeywords(c.text),
      });
    }
  }

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
