import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

const SAMPLE = `---
title: tiny
url: about:blank
---

# Hello

\`\`\`playwright
await fx.say("Welcome to the tour.");
await fx.click("button.primary", "the primary button");
await fx.typeWithDelay("input.name", "Holiday landing page");
\`\`\`
`;

const SAMPLE_WITH_WARNING = `---
title: tiny-warn
url: about:blank
---

# Hello

\`\`\`playwright
await page.click("button.primary");
\`\`\`
`;

describe("daymo manual", () => {
  it("writes manual.md next to the source .demo by default", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, SAMPLE);

    const { exitCode } = await execa("node", [cliBin, "manual", file]);
    expect(exitCode).toBe(0);

    const md = await fs.readFile(path.join(dir, "manual.md"), "utf8");
    expect(md).toContain("# tiny");
    expect(md).toContain("Welcome to the tour.");
    expect(md).toContain("Click **the primary button**.");
    expect(md).toContain('Type **"Holiday landing page"**.');
  });

  it("respects --out", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-out-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, SAMPLE);
    const customOut = path.join(dir, "custom", "guide.md");
    await fs.mkdir(path.dirname(customOut), { recursive: true });

    const { exitCode } = await execa("node", [cliBin, "manual", file, "--out", customOut]);
    expect(exitCode).toBe(0);
    expect((await fs.stat(customOut)).isFile()).toBe(true);
    await expect(fs.stat(path.join(dir, "manual.md"))).rejects.toThrow(); // not written
  });

  it("prints to stdout when --stdout is set and writes no file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-stdout-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, SAMPLE);

    const { exitCode, stdout } = await execa("node", [cliBin, "manual", file, "--stdout"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("# tiny");
    expect(stdout).toContain("Click **the primary button**.");
    await expect(fs.stat(path.join(dir, "manual.md"))).rejects.toThrow();
  });

  it("emits warnings to stderr for bare page.click without description", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-warn-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, SAMPLE_WITH_WARNING);

    const { exitCode, stderr } = await execa("node", [cliBin, "manual", file]);
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/warning: line \d+: click has no description/);
    const md = await fs.readFile(path.join(dir, "manual.md"), "utf8");
    expect(md).toContain("## Warnings");
  });

  it("exits non-zero on a missing input file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-manual-missing-"));
    const file = path.join(dir, "does-not-exist.demo");
    const { exitCode, stderr } = await execa("node", [cliBin, "manual", file], { reject: false });
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/ENOENT|no such file/i);
  });
});
