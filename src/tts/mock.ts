// src/tts/mock.ts
import type { TtsProvider, SynthesizeInput, SynthesizeOutput, WordTiming } from "./provider.js";

const MS_PER_WORD = 500;

/** Minimal MP3 frame ("silence") — 32 bytes of MPEG-1 layer 3 silence header. */
const SILENCE_FRAME = Buffer.from([
  0xff, 0xfb, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

export class MockTtsProvider implements TtsProvider {
  readonly id = "mock";

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    const words = input.text.split(/\s+/).filter(Boolean);
    const timings: WordTiming[] = words.map((w, i) => ({
      word: w,
      startMs: i * MS_PER_WORD,
      endMs: (i + 1) * MS_PER_WORD,
    }));
    // Allocate enough silence frames to cover total duration
    const totalMs = words.length * MS_PER_WORD;
    const frames = Math.max(1, Math.ceil(totalMs / 26)); // ~26ms per MPEG frame
    const audio = Buffer.concat(Array.from({ length: frames }, () => SILENCE_FRAME));
    return { audio, timings };
  }
}
