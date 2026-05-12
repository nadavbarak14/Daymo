import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { startEditor, type EditorHandle } from "../../src/editor/index.js";

const DEMO_SRC = `---
title: T
url: http://localhost:9999
---

# Scene 1

\`\`\`playwright
await fx.step("Click the button");
await fx.say("hello");
await fx.banner("Banner A");
\`\`\`
`;

describe("editor /api/step", () => {
  let dir: string;
  let demoFile: string;
  let h: EditorHandle;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "editor-step-"));
    demoFile = path.join(dir, "x.demo");
    await fs.writeFile(demoFile, DEMO_SRC);
    h = await startEditor({ demoFile });
  });

  afterEach(async () => {
    await h.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function post(body: object) {
    return fetch(`${h.url}/api/step`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rewrites a step description", async () => {
    const r = await post({ sceneIndex: 0, stepIndex: 1, kind: "description", text: "New description" });
    expect(r.status).toBe(200);
    const src = await fs.readFile(demoFile, "utf8");
    expect(src).toContain('await fx.step("New description");');
  });

  it("rewrites a step say literal", async () => {
    const r = await post({ sceneIndex: 0, stepIndex: 1, kind: "say", text: "Goodbye" });
    expect(r.status).toBe(200);
    const src = await fs.readFile(demoFile, "utf8");
    expect(src).toContain('await fx.say("Goodbye");');
  });

  it("rewrites a step banner literal", async () => {
    const r = await post({ sceneIndex: 0, stepIndex: 1, kind: "banner", text: "Banner B" });
    expect(r.status).toBe(200);
    const src = await fs.readFile(demoFile, "utf8");
    expect(src).toContain('await fx.banner("Banner B"');
  });

  it("rejects editing the preamble description", async () => {
    const r = await post({ sceneIndex: 0, stepIndex: 0, kind: "description", text: "x" });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/preamble/);
  });

  it("rejects out-of-range scene", async () => {
    const r = await post({ sceneIndex: 99, stepIndex: 0, kind: "description", text: "x" });
    expect(r.status).toBe(404);
  });
});
