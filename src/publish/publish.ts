import fs from "node:fs/promises";
import path from "node:path";
import type { IndexFile } from "../types.js";
import { buildManifest } from "./manifest.js";
import type { Uploader } from "./types.js";

export interface PublishOpts {
  dataRoot: string;
  widgetId: string;
  version: string;
  uploader: Uploader;
  log?: (msg: string) => void;
}

export interface PublishSummary {
  videoCount: number;
  missingVideos: string[];
}

/** Read an indexed widget dir and upload manifest.json, index.json, and each
 *  demo's output.mp4 (+ optional output.vtt) through the uploader. */
export async function publish(opts: PublishOpts): Promise<PublishSummary> {
  const log = opts.log ?? (() => {});
  const dir = path.join(opts.dataRoot, "widgets", opts.widgetId);
  const index = JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8")) as IndexFile;

  const manifest = buildManifest(index, { version: opts.version });
  await opts.uploader.put("manifest.json", JSON.stringify(manifest, null, 2), "application/json");
  await opts.uploader.put("index.json", JSON.stringify(index), "application/json");

  let videoCount = 0;
  const missingVideos: string[] = [];
  for (const demo of index.demos) {
    const demoDir = path.join(dir, "demos", demo.demoId);
    try {
      const mp4 = await fs.readFile(path.join(demoDir, "output.mp4"));
      await opts.uploader.put(`${demo.demoId}/output.mp4`, mp4, "video/mp4");
      videoCount += 1;
    } catch {
      missingVideos.push(demo.demoId);
      log(`WARN: no output.mp4 for demo "${demo.demoId}" — skipped`);
    }
    try {
      const vtt = await fs.readFile(path.join(demoDir, "output.vtt"));
      await opts.uploader.put(`${demo.demoId}/output.vtt`, vtt, "text/vtt");
    } catch {
      /* captions are optional */
    }
  }
  log(`published ${videoCount} video(s); manifest + index uploaded`);
  return { videoCount, missingVideos };
}
