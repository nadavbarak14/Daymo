import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { execa } from "execa";
import { stitch } from "../../src/editor/stitch.js";

async function makeTinyWebm(out: string) {
  await execa("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=red:size=320x240:duration=1:rate=30",
    "-c:v", "libvpx", out,
  ]);
}

describe("stitch", () => {
  it("concatenates two clips and produces an mp4", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-stitch-"));
    const a = path.join(tmp, "scene-001.webm");
    const b = path.join(tmp, "scene-002.webm");
    await makeTinyWebm(a);
    await makeTinyWebm(b);
    const out = path.join(tmp, "output.mp4");
    await stitch({
      scenes: [
        { webm: a, sayEvents: [] },
        { webm: b, sayEvents: [] },
      ],
      music: null,
      output: out,
      workDir: tmp,
      ttsDir: path.join(tmp, "tts"),
    });
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  }, 30_000);
});
