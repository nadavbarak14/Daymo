// tests/unit/tts-provider-contract.test.ts
//
// Contract tests for the TtsProvider interface defined in src/tts/provider.ts.
// Both shipped providers (MockTtsProvider, EdgeTtsProvider) MUST satisfy this contract;
// CachedTtsProvider is a decorator that ALSO satisfies it. A network-using provider
// is not exercised here — we only verify the public surface matches the interface.
import { describe, it, expect } from "vitest";
import type { TtsProvider } from "../../src/tts/provider.js";
import { MockTtsProvider } from "../../src/tts/mock.js";
import { EdgeTtsProvider } from "../../src/tts/edge.js";
import { CachedTtsProvider } from "../../src/tts/cache.js";

function assertConformsToTtsProvider(p: TtsProvider, expectedId: string) {
  expect(typeof p.id).toBe("string");
  expect(p.id).toBe(expectedId);
  expect(typeof p.synthesize).toBe("function");
}

describe("TtsProvider contract", () => {
  it("MockTtsProvider conforms to the interface and has id='mock'", () => {
    assertConformsToTtsProvider(new MockTtsProvider(), "mock");
  });

  it("EdgeTtsProvider conforms to the interface and has id='edge'", () => {
    assertConformsToTtsProvider(new EdgeTtsProvider(), "edge");
  });

  it("CachedTtsProvider preserves the inner provider's id and synthesize()", async () => {
    const inner = new MockTtsProvider();
    // Cache dir doesn't need to exist — first call writes the cache file.
    const tmp = `/tmp/daymo-cache-contract-${Date.now()}`;
    const cached = new CachedTtsProvider(inner, tmp);
    assertConformsToTtsProvider(cached, "mock");

    const out = await cached.synthesize({ text: "hello world", voice: "v", rate: "+0%" });
    expect(Buffer.isBuffer(out.audio)).toBe(true);
    expect(Array.isArray(out.timings)).toBe(true);
    expect(out.timings.every((t) => typeof t.word === "string" && typeof t.startMs === "number" && typeof t.endMs === "number")).toBe(true);
  });
});

describe("MockTtsProvider output shape", () => {
  it("returns no timings and non-empty audio for empty text", async () => {
    const p = new MockTtsProvider();
    const out = await p.synthesize({ text: "", voice: "v", rate: "+0%" });
    expect(out.timings).toEqual([]);
    expect(out.audio.length).toBeGreaterThan(0);
  });

  it("timings are strictly monotonic and non-overlapping", async () => {
    const p = new MockTtsProvider();
    const out = await p.synthesize({ text: "one two three four", voice: "v", rate: "+0%" });
    expect(out.timings).toHaveLength(4);
    for (let i = 1; i < out.timings.length; i++) {
      expect(out.timings[i].startMs).toBeGreaterThanOrEqual(out.timings[i - 1].endMs);
      expect(out.timings[i].endMs).toBeGreaterThan(out.timings[i].startMs);
    }
  });

  it("collapses repeated whitespace and skips empty tokens", async () => {
    const p = new MockTtsProvider();
    const out = await p.synthesize({ text: "  hello   world  ", voice: "v", rate: "+0%" });
    expect(out.timings.map((t) => t.word)).toEqual(["hello", "world"]);
  });

  it("audio is long enough to span the last word's endMs", async () => {
    const p = new MockTtsProvider();
    const out = await p.synthesize({ text: "a b c d e", voice: "v", rate: "+0%" });
    // 5 words * 500ms = 2500ms total. At ~26.122ms per frame * 104 bytes,
    // audio should be ≥ ceil(2500/26.122) * 104 bytes ≈ 9984 bytes.
    expect(out.audio.length).toBeGreaterThanOrEqual(9984);
  });
});
