import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

async function tmpDemoWithCaptures(): Promise<{ file: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-stitch-step-index-"));
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

---

# Two

\`\`\`playwright
await fx.step("Click button");
await fx.pause(0.1);
\`\`\`
`);
  await execa("node", [cliBin, "capture", file, "--all"]);
  return { file, dir };
}

describe("daymo stitch writes step-index.json", () => {
  it("emits .daymo/step-index.json alongside output.mp4", async () => {
    const { file, dir } = await tmpDemoWithCaptures();
    await execa("node", [cliBin, "stitch", file]);
    const idxPath = path.join(dir, ".daymo", "step-index.json");
    const raw = await fs.readFile(idxPath, "utf8");
    const idx = JSON.parse(raw);
    expect(idx.demoId).toBe("tiny");
    expect(idx.scenes.length).toBe(2);
    expect(idx.steps[0].stepId).toBe("tiny:0:0");
    expect(idx.steps[0].description).toBe("(preamble)");
    expect(idx.mp4DurationMs).toBeGreaterThan(0);
    // Scene 2 has an explicit fx.step at index 1
    const explicit = idx.steps.find((s: any) => s.stepId === "tiny:1:1");
    expect(explicit).toBeDefined();
    expect(explicit.description).toBe("Click button");
  }, 120_000);
});
