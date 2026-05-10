import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

describe("daymo set-prose", () => {
  it("rewrites scene prose in place", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-prose-"));
    const file = path.join(dir, "tiny.demo");
    await fs.writeFile(file, `---
title: tiny
url: about:blank
---

# One

Old prose.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`);
    const { exitCode } = await execa("node", [cliBin, "set-prose", file, "--scene", "1", "--text", "New prose."]);
    expect(exitCode).toBe(0);
    const after = await fs.readFile(file, "utf8");
    expect(after).toMatch(/New prose\./);
    expect(after).not.toMatch(/Old prose\./);
  });
});
