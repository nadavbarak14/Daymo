// tests/integration/check.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { startFixtureServer } from "./server.js";
import { checkDemo, applyBaseUrl } from "../../src/core/check.js";
import { checkCommand } from "../../src/commands/check.js";

// The create button lives inside a <dialog> that is only shown after clicking
// "New project" — so `fx.cursorTo("[data-testid=create-btn]")` only resolves a
// bounding box mid-flow. This is the case a static selector lint can't catch.
const GOOD = `---
title: New project
url: http://localhost:9999/
---

# New project

\`\`\`playwright
await fx.step("Open the dialog");
await page.click("[data-testid=new-project-btn]");
await fx.step("Point at create");
await fx.cursorTo("[data-testid=create-btn]", "the create button");
\`\`\`
`;

const BAD = `---
title: Broken demo
url: http://localhost:9999/
---

# Broken demo

\`\`\`playwright
await fx.step("Highlight a ghost");
await fx.highlight("[data-testid=does-not-exist]", "ghost");
\`\`\`
`;

describe("daymo check", () => {
  let serverUrl: string;
  let close: () => Promise<void>;
  let dir: string;

  beforeAll(async () => {
    const s = await startFixtureServer();
    serverUrl = s.url;
    close = s.close;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-check-"));
    await fs.mkdir(path.join(dir, "01-good"));
    await fs.writeFile(path.join(dir, "01-good", "01-good.demo"), GOOD);
    await fs.mkdir(path.join(dir, "02-bad"));
    await fs.writeFile(path.join(dir, "02-bad", "02-bad.demo"), BAD);
  });

  afterAll(async () => {
    await close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("applyBaseUrl swaps the origin and keeps the path + query", () => {
    expect(applyBaseUrl("http://localhost:3000/dashboard?x=1", "http://127.0.0.1:8080")).toBe(
      "http://127.0.0.1:8080/dashboard?x=1",
    );
    expect(applyBaseUrl("http://localhost:3000/p", undefined)).toBe("http://localhost:3000/p");
  });

  it("passes a demo whose selector only appears after a click", async () => {
    const r = await checkDemo(path.join(dir, "01-good", "01-good.demo"), {
      baseUrl: serverUrl,
      timeoutMs: 5000,
    });
    expect(r.ok).toBe(true);
    expect(r.demoId).toBe("01-good");
    expect(r.steps.length).toBe(2);
  });

  it("fails a demo with a missing selector, reporting the step + selector", async () => {
    const r = await checkDemo(path.join(dir, "02-bad", "02-bad.demo"), {
      baseUrl: serverUrl,
      timeoutMs: 3000,
    });
    expect(r.ok).toBe(false);
    expect(r.failure?.selector).toBe("[data-testid=does-not-exist]");
    expect(r.failure?.step?.label).toBe("Highlight a ghost");
    expect(r.failure?.file).toContain("02-bad.demo");
  });

  it("checkCommand discovers both demos recursively and sets exit code 1", async () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((s: unknown) => (writes.push(String(s)), true));
    const prev = process.exitCode;
    process.exitCode = 0;
    try {
      await checkCommand(dir, { baseUrl: serverUrl, timeout: 5000, json: true });
    } finally {
      spy.mockRestore();
    }
    expect(process.exitCode).toBe(1);
    process.exitCode = prev;

    const out = JSON.parse(writes.join(""));
    expect(out.ok).toBe(false);
    expect(out.demos.map((d: { demoId: string }) => d.demoId).sort()).toEqual([
      "01-good",
      "02-bad",
    ]);
  });
});
