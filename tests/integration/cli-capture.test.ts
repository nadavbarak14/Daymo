import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

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

---

# Scene two

World.

\`\`\`playwright
await fx.pause(0.1);
\`\`\`
`;

async function tmpDemo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cli-capture-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, tinyDemo);
  return file;
}

describe("daymo capture", () => {
  it("--scene N captures one scene and updates state.json", async () => {
    const file = await tmpDemo();
    const { stdout, exitCode } = await execa("node", [cliBin, "capture", file, "--scene", "1"]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/scene-001\.webm/);
    const state = JSON.parse(await fs.readFile(path.join(path.dirname(file), ".daymo/state.json"), "utf8"));
    expect(state.scenes[0].state).toBe("captured");
    expect(state.scenes[1].state).toBe("pending");
  }, 60_000);

  it("--all captures every scene", async () => {
    const file = await tmpDemo();
    const { exitCode } = await execa("node", [cliBin, "capture", file, "--all"]);
    expect(exitCode).toBe(0);
    const state = JSON.parse(await fs.readFile(path.join(path.dirname(file), ".daymo/state.json"), "utf8"));
    expect(state.scenes.every((r: any) => r.state === "captured")).toBe(true);
  }, 120_000);

  it("--scene out of range exits non-zero", async () => {
    const file = await tmpDemo();
    const result = await execa("node", [cliBin, "capture", file, "--scene", "99"], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/out of range|99/);
  });

  it("--scene and --all are mutually exclusive", async () => {
    const file = await tmpDemo();
    const result = await execa("node", [cliBin, "capture", file, "--scene", "1", "--all"], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--scene.*--all|--all.*--scene/);
  });
});
