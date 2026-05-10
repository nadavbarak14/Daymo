import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

describe("end-to-end TTS render (mock provider)", () => {
  it("captures + stitches a demo with fx.say and produces an audible output.mp4", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-e2e-tts-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, `---
title: tiny
url: about:blank
viewport: { width: 200, height: 200 }
---

# One

\`\`\`playwright
await fx.say("hello world");
await fx.pause(0.2);
\`\`\`
`);
    const env = { ...process.env, DAYMO_TTS_PROVIDER: "mock" };
    await execa("node", [cliBin, "capture", file, "--all"], { env });
    await execa("node", [cliBin, "stitch", file], { env });

    const out = path.join(dir, "output.mp4");
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);

    // Probe via ffprobe to assert there is an audio stream
    const { stdout } = await execa("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", out]);
    const probed = JSON.parse(stdout);
    const types = probed.streams.map((s: any) => s.codec_type);
    expect(types).toContain("audio");
  }, 120_000);
});
