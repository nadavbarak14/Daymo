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
