import { describe, it, expect } from "vitest";
import { MockTtsProvider } from "../../src/tts/mock.js";

describe("MockTtsProvider", () => {
  it("returns 1s of silence per word with even timings", async () => {
    const p = new MockTtsProvider();
    const out = await p.synthesize({ text: "hello world", voice: "x", rate: "+0%" });
    expect(out.timings).toHaveLength(2);
    expect(out.timings[0].word).toBe("hello");
    expect(out.timings[1].word).toBe("world");
    // 500ms per word
    expect(out.timings[1].endMs).toBe(1000);
    expect(out.audio.length).toBeGreaterThan(0);
  });
});
