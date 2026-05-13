// tests/integration/cli-doctor.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

describe("daymo doctor", () => {
  it("reports both ffmpeg and chromium as OK in a healthy environment", async () => {
    const { stdout, exitCode } = await execa("node", [cliBin, "doctor"], { reject: false });
    expect(stdout).toMatch(/ffmpeg/);
    expect(stdout).toMatch(/playwright chromium/);
    // In CI we install ffmpeg + chromium, so doctor should exit 0.
    // Local devs without one of the two will see exit 1 — assert via the marks instead of just exitCode.
    const ffmpegOk = /✓\s+ffmpeg/.test(stdout);
    const chromiumOk = /✓\s+playwright chromium/.test(stdout);
    if (ffmpegOk && chromiumOk) {
      expect(exitCode).toBe(0);
    } else {
      expect(exitCode).toBe(1);
    }
  }, 30000);

  it("exits 1 with a clear ffmpeg failure when ffmpeg is not on PATH", async () => {
    // Point PATH only at an empty dir so `execa("ffmpeg", …)` cannot resolve.
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-doctor-empty-"));
    // Use process.execPath so PATH={empty} can't break node resolution itself.
    const { stdout, exitCode } = await execa(process.execPath, [cliBin, "doctor"], {
      reject: false,
      env: { ...process.env, PATH: emptyDir },
    });
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/✗\s+ffmpeg/);
    expect(stdout).toMatch(/not found in PATH/);
  }, 30000);
});
