import type { HelpManifest } from "../publish/types.js";

export interface GalleryCard {
  demoId: string;
  title: string;
  description: string;
  durationLabel: string; // "m:ss"
  videoUrl: string;
  posterUrl: string;
  stepCount: number;
}

export interface GalleryModel {
  cards: GalleryCard[];
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

/** Pure transform from the published manifest to gallery display data. */
export function buildGalleryModel(manifest: HelpManifest): GalleryModel {
  return {
    cards: manifest.demos.map((d) => ({
      demoId: d.demoId,
      title: d.title,
      description: d.description,
      durationLabel: formatDuration(d.durationMs),
      videoUrl: d.videoUrl,
      posterUrl: d.posterUrl,
      stepCount: d.steps.length,
    })),
  };
}
