// tests/integration/runner.test.ts
//
// Direct tests for src/runner.ts. The e2e smoke covers the happy "produces an mp4"
// path; this file exercises behaviors that the smoke does not:
//   - artifacts land under the supplied artifactsBase
//   - each render() call gets its own unique subdirectory under artifactsBase
//   - render() returns { mp4Path, artifactsDir } pointing at real files
// All cases use DAYMO_TTS_PROVIDER=mock so they run without network or audio synthesis.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { render } from "../../src/runner.js";

const tinyDemo = (url: string) => `---
title: tiny
url: ${url}
viewport: { width: 200, height: 200 }
---

# Scene one

Hello.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;

describe("runner.render()", () => {
  let workDir: string;
  let demoFile: string;
  const originalProvider = process.env.DAYMO_TTS_PROVIDER;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-runner-"));
    demoFile = path.join(workDir, "tiny.demo");
    await fs.writeFile(demoFile, tinyDemo("about:blank"));
  });
  afterAll(async () => {
    if (originalProvider === undefined) delete process.env.DAYMO_TTS_PROVIDER;
    else process.env.DAYMO_TTS_PROVIDER = originalProvider;
    await fs.rm(workDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    process.env.DAYMO_TTS_PROVIDER = "mock";
  });

  it("writes output.mp4 under artifactsBase and returns paths that exist", async () => {
    const outBase = path.join(workDir, "out-A");
    const result = await render({ demoFile, artifactsBase: outBase });

    expect(result.artifactsDir.startsWith(path.resolve(outBase))).toBe(true);
    expect(result.mp4Path).toBe(path.join(result.artifactsDir, "output.mp4"));

    const stat = await fs.stat(result.mp4Path);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(1000);

    const dirStat = await fs.stat(result.artifactsDir);
    expect(dirStat.isDirectory()).toBe(true);
  }, 60_000);

  it("each call to render() produces a distinct artifactsDir under the same artifactsBase", async () => {
    const outBase = path.join(workDir, "out-B");
    const a = await render({ demoFile, artifactsBase: outBase });
    const b = await render({ demoFile, artifactsBase: outBase });

    expect(a.artifactsDir).not.toBe(b.artifactsDir);
    expect(path.dirname(a.artifactsDir)).toBe(path.dirname(b.artifactsDir));

    const entries = (await fs.readdir(outBase)).sort();
    expect(entries).toHaveLength(2);
  }, 120_000);
});
