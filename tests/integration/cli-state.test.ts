import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

const tinyDemo = `---
title: tiny
url: about:blank
---

# Scene one

Hello world.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;

async function tmpDemo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-state-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, tinyDemo);
  return file;
}

describe("daymo state", () => {
  it("prints scene table with all pending when no .daymo/", async () => {
    const file = await tmpDemo();
    const { stdout } = await execa("node", [cliBin, "state", file]);
    expect(stdout).toMatch(/Scene one/);
    expect(stdout).toMatch(/pending/);
  });

  it("--json emits machine-readable state", async () => {
    const file = await tmpDemo();
    const { stdout } = await execa("node", [cliBin, "state", file, "--json"]);
    const parsed = JSON.parse(stdout);
    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.scenes[0].state).toBe("pending");
  });
});
