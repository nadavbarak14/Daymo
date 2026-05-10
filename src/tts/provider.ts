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
  synthesize(input: SynthesizeInput): Promise<SynthesizeOutput>;
}
