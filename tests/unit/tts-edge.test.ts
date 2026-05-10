import { describe, it, expect } from "vitest";
import { EdgeTtsProvider } from "../../src/tts/edge.js";

const RUN = !!process.env.DAYMO_RUN_EDGE_TTS;

describe("EdgeTtsProvider (network)", () => {
  it.skipIf(!RUN)("synthesizes hello world with word boundaries", async () => {
    const p = new EdgeTtsProvider();
    const out = await p.synthesize({ text: "Hello world.", voice: "en-US-AriaNeural", rate: "+0%" });
    expect(out.audio.length).toBeGreaterThan(1000);
    expect(out.timings.length).toBeGreaterThanOrEqual(2);
    expect(out.timings[0].word.toLowerCase()).toBe("hello");
    expect(out.timings[0].endMs).toBeGreaterThan(out.timings[0].startMs);
  }, 30_000);

  it("type id is 'edge'", () => {
    expect(new EdgeTtsProvider().id).toBe("edge");
  });
});
