// tests/integration/cli-render.test.ts
import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

// Minimal demo with no narration so render is fast even on slow CI.
const tinyDemo = `---
title: tiny
url: about:blank
viewport: { width: 200, height: 200 }
---

# Scene one

Hello.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;

async function tmpDemo(): Promise<{ file: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-render-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, tinyDemo);
  return { file, dir };
}

describe("daymo render", () => {
  it("--help lists the render command and its --out flag", async () => {
    const { stdout, exitCode } = await execa("node", [cliBin, "render", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/render/);
    expect(stdout).toMatch(/--out/);
  });

  it("produces an output.mp4 under a unique subdir of --out and logs both paths", async () => {
    const { file, dir } = await tmpDemo();
    const outBase = path.join(dir, "artifacts-out");
    const env = { ...process.env, DAYMO_TTS_PROVIDER: "mock" };
    const { stdout, exitCode } = await execa(
      "node",
      [cliBin, "render", file, "--out", outBase],
      { env },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/daymo: rendering /);
    expect(stdout).toMatch(/daymo: wrote .*output\.mp4/);
    expect(stdout).toMatch(/daymo: artifacts in /);

    // Runner writes to <outBase>/<random-id>/output.mp4 — there should be exactly one subdir.
    const subdirs = await fs.readdir(outBase);
    expect(subdirs).toHaveLength(1);
    const mp4 = path.join(outBase, subdirs[0], "output.mp4");
    const stat = await fs.stat(mp4);
    expect(stat.size).toBeGreaterThan(1000);
  }, 60_000);

  it("exits non-zero with a clear error when the demo file does not exist", async () => {
    const missing = path.join(os.tmpdir(), `daymo-missing-${Date.now()}.demo`);
    const { stderr, exitCode } = await execa(
      "node",
      [cliBin, "render", missing],
      { reject: false },
    );
    expect(exitCode).not.toBe(0);
    expect(stderr + "").toMatch(/ENOENT|no such file/i);
  }, 15_000);
});
