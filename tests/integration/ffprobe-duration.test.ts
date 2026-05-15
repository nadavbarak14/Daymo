import { describe, it, expect, beforeAll } from "vitest";
import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeDurationMs } from "../../src/core/ffprobe.js";

describe("probeDurationMs (integration with real ffmpeg)", () => {
  let tmpFile: string;

  beforeAll(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-ffprobe-"));
    tmpFile = path.join(dir, "fixture.mp4");
    await execa("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=size=320x240:rate=24:color=black",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
      "-t", "2",
      "-c:v", "libx264", "-c:a", "aac",
      tmpFile,
    ]);
  }, 30_000);

  it("returns the duration of the file in ms (within 100ms of expected)", async () => {
    const ms = await probeDurationMs(tmpFile);
    expect(ms).toBeGreaterThanOrEqual(1900);
    expect(ms).toBeLessThanOrEqual(2100);
  });

  it("throws a clear error when the file does not exist", async () => {
    await expect(probeDurationMs("/no/such/file.mp4")).rejects.toThrow(/ffprobe/i);
  });
});
