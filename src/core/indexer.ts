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
