// tests/integration/capture-compose.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import { capture, composeFromBundle } from "../../src/runner.js";
import { startFixtureServer } from "./server.js";

describe("capture → compose", () => {
  it("two compose passes against the same bundle produce byte-equal mp4s", async () => {
    const srv = await startFixtureServer();
    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-int-"));
      const demoFile = path.join(tmp, "demo.demo");
      await fs.writeFile(demoFile, `---
title: t
url: ${srv.url}
defaultTransition: none
intro: false
outro: false
mocks:
  - source: inline
    routes:
      "GET /api/me": { "name": "Alex" }
      "GET /api/projects": []
---

# only scene

\`\`\`playwright
await page.waitForSelector("body");
\`\`\`
`);
      const { artifactsDir } = await capture({ demoFile, artifactsBase: tmp });

      // First compose pass
      const { mp4Path: a } = await composeFromBundle({ bundleDir: artifactsDir });
      const aBytes = await fs.readFile(a);
      const aHash = crypto.createHash("sha256").update(aBytes).digest("hex");

      // Second compose pass — overwrites output.mp4
      const { mp4Path: b } = await composeFromBundle({ bundleDir: artifactsDir });
      const bBytes = await fs.readFile(b);
      const bHash = crypto.createHash("sha256").update(bBytes).digest("hex");

      expect(b).toBe(a);                  // same path
      expect(bHash).toBe(aHash);          // byte-equal contents
    } finally {
      await srv.close();
    }
  }, 60_000);
});
