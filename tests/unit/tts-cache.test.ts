import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { CachedTtsProvider, computeKey } from "../../src/tts/cache.js";
import { MockTtsProvider } from "../../src/tts/mock.js";

describe("CachedTtsProvider", () => {
  it("hashes (text, voice, rate, providerId) deterministically", () => {
    const k1 = computeKey({ text: "hi", voice: "v1", rate: "+0%", providerId: "edge" });
    const k2 = computeKey({ text: "hi", voice: "v1", rate: "+0%", providerId: "edge" });
    const k3 = computeKey({ text: "hi", voice: "v2", rate: "+0%", providerId: "edge" });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("misses then hits — second call has zero invocations", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-tts-"));
    let calls = 0;
    const inner = new MockTtsProvider();
    const wrapped = {
      id: "mock",
      synthesize: async (input: any) => { calls++; return inner.synthesize(input); },
    };
    const cache = new CachedTtsProvider(wrapped as any, dir);
    await cache.synthesize({ text: "hello world", voice: "x", rate: "+0%" });
    await cache.synthesize({ text: "hello world", voice: "x", rate: "+0%" });
    expect(calls).toBe(1);
    const files = await fs.readdir(dir);
    const hash = computeKey({ text: "hello world", voice: "x", rate: "+0%", providerId: "mock" });
    expect(files).toContain(`${hash}.mp3`);
    expect(files).toContain(`${hash}.timings.json`);
    expect(files).toContain(`${hash}.meta.json`);
  });

  it("treats missing timings as cache miss", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-tts-"));
    let calls = 0;
    const inner = new MockTtsProvider();
    const wrapped = {
      id: "mock",
      synthesize: async (input: any) => { calls++; return inner.synthesize(input); },
    };
    const cache = new CachedTtsProvider(wrapped as any, dir);
    await cache.synthesize({ text: "hi", voice: "x", rate: "+0%" });
    expect(calls).toBe(1);
    // Corrupt: delete timings file
    const hash = computeKey({ text: "hi", voice: "x", rate: "+0%", providerId: "mock" });
    await fs.rm(path.join(dir, `${hash}.timings.json`));
    await cache.synthesize({ text: "hi", voice: "x", rate: "+0%" });
    expect(calls).toBe(2);
  });
});
