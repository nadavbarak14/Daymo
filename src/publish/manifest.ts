import type { IndexFile } from "../types.js";
import type { HelpManifest, ManifestDemo, ManifestStep } from "./types.js";

export interface BuildManifestOpts {
  version: string;
}

/** Build the demos-only gallery manifest. Never includes embeddings — only the
 *  data the gallery needs (titles, durations, video/poster URLs, step markers). */
export function buildManifest(index: IndexFile, opts: BuildManifestOpts): HelpManifest {
  const stepsByDemo = new Map<string, ManifestStep[]>();
  for (const c of index.chunks) {
    const label =
      c.text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .at(-1) ?? c.stepId;
    const arr = stepsByDemo.get(c.demoId) ?? [];
    arr.push({ stepId: c.stepId, label, startMs: c.globalStartMs });
    stepsByDemo.set(c.demoId, arr);
  }
  for (const arr of stepsByDemo.values()) arr.sort((a, b) => a.startMs - b.startMs);

  const demos: ManifestDemo[] = index.demos.map((d) => ({
    demoId: d.demoId,
    title: d.title,
    description: d.description,
    durationMs: d.durationMs,
    videoUrl: `${index.videoBaseUrl}/${d.demoId}/output.mp4`,
    posterUrl: `${index.videoBaseUrl}/${d.demoId}/poster.jpg`,
    steps: stepsByDemo.get(d.demoId) ?? [],
  }));

  return { version: opts.version, videoBaseUrl: index.videoBaseUrl, demos };
}
