import type { VideoPart } from "./types.js";

/**
 * Subset of the published help-center manifest (`HelpManifest` in
 * src/publish/types.ts) the widget cares about. `daymo publish` writes
 * manifest.json next to the demo videos, so when the host product also runs
 * the help center the widget can read the exact same files: posters for the
 * answer cards and the same output.mp4 the help page plays.
 */
export interface ManifestDemo {
  demoId: string;
  title: string;
  videoUrl: string;
  posterUrl?: string;
}

export interface HelpManifest {
  version: string;
  videoBaseUrl: string;
  demos: ManifestDemo[];
}

/**
 * Best-effort load of the shared manifest. The widget never depends on it:
 * any failure (404, network, malformed JSON) resolves to an empty map and the
 * chat answers fall back to the mp4Url the backend provides.
 */
export async function loadManifest(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, ManifestDemo>> {
  const byId = new Map<string, ManifestDemo>();
  try {
    const res = await fetchFn(url);
    if (!res.ok) return byId;
    const manifest = (await res.json()) as HelpManifest;
    if (!Array.isArray(manifest?.demos)) return byId;
    for (const d of manifest.demos) {
      if (d?.demoId && d?.videoUrl) byId.set(d.demoId, d);
    }
  } catch { /* manifest is optional */ }
  return byId;
}

export interface VideoSource {
  /** Playback URL — the manifest's videoUrl (same file the help page plays) when available. */
  mp4Url: string;
  /** Poster for the answer-card thumbnail — only available via the manifest. */
  posterUrl?: string;
  /** Demo title from the manifest (e.g. for the card label / caption). */
  title?: string;
}

/** Resolve where a cited clip should play from, preferring the shared manifest. */
export function resolveVideoSource(
  part: VideoPart,
  demos: Map<string, ManifestDemo>,
): VideoSource {
  const demo = demos.get(part.demoId);
  if (!demo) return { mp4Url: part.mp4Url };
  return { mp4Url: demo.videoUrl, posterUrl: demo.posterUrl, title: demo.title };
}
