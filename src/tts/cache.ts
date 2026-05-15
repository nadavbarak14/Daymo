// src/tts/cache.ts
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import type { TtsProvider, SynthesizeInput, SynthesizeOutput, WordTiming } from "./provider.js";

export function computeKey(input: { text: string; voice: string; rate: string; providerId: string; cacheVersion?: number }): string {
  // cacheVersion=1 is the historical default; passing it explicitly produces
  // the same digest as omitting it, so existing on-disk hashes are stable.
  const cacheVersion = input.cacheVersion ?? 1;
  const base: Record<string, unknown> = {
    text: input.text,
    voice: input.voice,
    rate: input.rate,
    providerId: input.providerId,
  };
  if (cacheVersion !== 1) base.cacheVersion = cacheVersion;
  const canon = JSON.stringify(base);
  return crypto.createHash("sha256").update(canon).digest("hex");
}

export class CachedTtsProvider implements TtsProvider {
  readonly id: string;
  readonly cacheVersion?: number;

  constructor(private inner: TtsProvider, private cacheDir: string) {
    this.id = inner.id;
    this.cacheVersion = inner.cacheVersion;
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    const key = computeKey({ ...input, providerId: this.inner.id, cacheVersion: this.inner.cacheVersion });
    await fs.mkdir(this.cacheDir, { recursive: true });
    const mp3 = path.join(this.cacheDir, `${key}.mp3`);
    const timingsFile = path.join(this.cacheDir, `${key}.timings.json`);
    const metaFile = path.join(this.cacheDir, `${key}.meta.json`);

    try {
      const [audio, timingsRaw] = await Promise.all([
        fs.readFile(mp3),
        fs.readFile(timingsFile, "utf8"),
      ]);
      const timings = JSON.parse(timingsRaw) as WordTiming[];
      if (!Array.isArray(timings)) throw new Error("invalid timings");
      return { audio, timings };
    } catch {
      // miss or corrupt — re-synthesize
    }

    const out = await this.inner.synthesize(input);
    await fs.writeFile(mp3, out.audio);
    await fs.writeFile(timingsFile, JSON.stringify(out.timings, null, 2));
    await fs.writeFile(metaFile, JSON.stringify({ ...input, providerId: this.inner.id }, null, 2));
    return out;
  }
}
