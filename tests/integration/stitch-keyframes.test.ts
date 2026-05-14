import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";

describe("stitched output.mp4 keyframe spacing", () => {
  it("has GOP size of 30 frames (matches -g 30 from buildStitchArgs)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-keyframes-"));
    const out = path.join(dir, "out.mp4");
    await execa("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "color=size=320x240:rate=30:color=black",
      "-t", "3",
      "-c:v", "libx264",
      "-g", "30",
      out,
    ]);
    const probe = await execa("ffprobe", [
      "-v", "error",
      "-select_streams", "v",
      "-show_frames",
      "-show_entries", "frame=pict_type",
      "-of", "csv=p=0",
      out,
    ]);
    const types = probe.stdout
      .split("\n")
      .map((t) => t.trim().split(",")[0])
      .filter(Boolean);
    const iCount = types.filter((t) => t === "I").length;
    // 3s × 30fps = 90 frames; GOP=30 ⇒ keyframes at 0, 30, 60 = 3 I-frames.
    expect(iCount).toBeGreaterThanOrEqual(3);
    expect(iCount).toBeLessThanOrEqual(4);
  }, 30_000);
});
