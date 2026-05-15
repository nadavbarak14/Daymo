// src/tts/provider.ts
export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SynthesizeInput {
  text: string;
  voice: string;
  rate: string; // SSML rate, e.g. "+0%"
}

export interface SynthesizeOutput {
  audio: Buffer;          // mp3 bytes
  timings: WordTiming[];
}

export interface TtsProvider {
  readonly id: string;    // e.g. "edge"
  /** Bumped when the synthesis pipeline changes in a way that should
   *  invalidate cached outputs (e.g. post-processing added, voice swapped).
   *  Folded into the cache key by CachedTtsProvider. Defaults to 1 when
   *  unset — older providers stay backward-compatible. */
  readonly cacheVersion?: number;
  synthesize(input: SynthesizeInput): Promise<SynthesizeOutput>;
}
