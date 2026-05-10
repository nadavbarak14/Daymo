// src/tts/edge.ts
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { TtsProvider, SynthesizeInput, SynthesizeOutput, WordTiming } from "./provider.js";

interface BoundaryEvent {
  Metadata?: Array<{
    Type: string;
    Data: {
      Offset: number;     // 100-ns units
      Duration: number;   // 100-ns units
      text?: { Text?: string };
    };
  }>;
}

const HUNDRED_NS_PER_MS = 10_000;

/** Convert SSML rate "+10%" / "-25%" / "+0%" to decimal multiplier (1.1, 0.75, 1.0). */
function ssmlRateToDecimal(rate: string): number {
  if (!rate) return 1.0;
  const m = /^([+-]?)(\d+(?:\.\d+)?)%$/.exec(rate.trim());
  if (!m) return 1.0;
  const sign = m[1] === "-" ? -1 : 1;
  const pct = parseFloat(m[2]) * sign;
  return 1.0 + pct / 100;
}

export class EdgeTtsProvider implements TtsProvider {
  readonly id = "edge";

  async synthesize(input: SynthesizeInput): Promise<SynthesizeOutput> {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      input.voice,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      { wordBoundaryEnabled: true, sentenceBoundaryEnabled: false } as any,
    );
    const rateDecimal = ssmlRateToDecimal(input.rate);
    const { audioStream, metadataStream } = await tts.toStream(input.text, { rate: rateDecimal });

    const audioChunks: Buffer[] = [];
    const timings: WordTiming[] = [];

    audioStream.on("data", (c: Buffer) => audioChunks.push(c));
    metadataStream?.on("data", (chunk: BoundaryEvent | Buffer | string) => {
      const events: BoundaryEvent[] = [];
      if (Buffer.isBuffer(chunk) || typeof chunk === "string") {
        const parsed = safeParse(chunk.toString());
        if (Array.isArray(parsed)) events.push(...parsed);
        else if (parsed) events.push(parsed);
      } else if (chunk && typeof chunk === "object") {
        events.push(chunk as BoundaryEvent);
      }
      for (const e of events) {
        for (const m of e.Metadata ?? []) {
          if (m.Type === "WordBoundary" && m.Data.text?.Text) {
            const startMs = Math.round(m.Data.Offset / HUNDRED_NS_PER_MS);
            const durMs = Math.round(m.Data.Duration / HUNDRED_NS_PER_MS);
            timings.push({ word: m.Data.text.Text, startMs, endMs: startMs + durMs });
          }
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      audioStream.on("end", () => resolve());
      audioStream.on("close", () => resolve());
      audioStream.on("error", reject);
    });

    return { audio: Buffer.concat(audioChunks), timings };
  }
}

function safeParse(s: string): BoundaryEvent[] | BoundaryEvent | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
