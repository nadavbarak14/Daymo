import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

async function tmpDemoWithCaptures(): Promise<{ file: string; dotDir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-stitch-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, `---
title: tiny
url: about:blank
viewport: { width: 200, height: 200 }
---

# One

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`);
  await execa("node", [cliBin, "capture", file, "--all"]);
  return { file, dotDir: path.join(dir, ".daymo") };
}

describe("daymo stitch", () => {
  it("composes captured scenes into output.mp4", async () => {
    const { file } = await tmpDemoWithCaptures();
    const { stdout, exitCode } = await execa("node", [cliBin, "stitch", file]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/output\.mp4/);
    const out = path.join(path.dirname(file), "output.mp4");
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(0);
  }, 60_000);

  it("errors when scenes are still pending", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-stitch-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, `---
title: tiny
url: about:blank
---

# One
\`\`\`playwright
await fx.pause(0.1);
\`\`\`

---

# Two
\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`);
    await execa("node", [cliBin, "capture", file, "--scene", "1"]);
    const result = await execa("node", [cliBin, "stitch", file], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/scenes not captured.*2/);
  }, 60_000);
});
