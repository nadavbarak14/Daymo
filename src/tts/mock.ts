// src/tts/mock.ts
import type { TtsProvider, SynthesizeInput, SynthesizeOutput, WordTiming } from "./provider.js";

const MS_PER_WORD = 500;

/**
 * One full MPEG-1 Layer 3 silence frame (32 kbps, 44.1 kHz, stereo).
 * Frame size = floor(144 * bitrate / sample_rate) = floor(144 * 32000 / 44100) = 104 bytes.
 * Header: FF FB 10 00 (sync + MPEG1 + Layer3 + no-CRC + 32kbps + 44.1kHz + no-pad + stereo).
 * The remaining 100 bytes are zeros, which decode to silence.
 * Frame duration: 1152 samples / 44100 Hz ≈ 26.122 ms.
 */
const SILENCE_FRAME = (() => {
  const buf = Buffer.alloc(104);
  buf[0] = 0xff;
  buf[1] = 0xfb;
  buf[2] = 0x10;
  buf[3] = 0x00;
  return buf;
})();
const FRAME_MS = 1152 / 44.1; // ≈ 26.122

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
    const totalMs = Math.max(1, words.length) * MS_PER_WORD;
    const frames = Math.max(2, Math.ceil(totalMs / FRAME_MS));
    const audio = Buffer.concat(Array.from({ length: frames }, () => SILENCE_FRAME));
    return { audio, timings };
  }
}
