// tests/integration/per-scene-capture.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { capture } from "../../src/runner.js";
import { startFixtureServer } from "./server.js";

describe("per-scene capture", () => {
  it("re-shoots a single scene without touching the others", async () => {
    const srv = await startFixtureServer();
    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-reshoot-"));
      const demoFile = path.join(tmp, "demo.demo");
      await fs.writeFile(demoFile, `---
title: t
url: ${srv.url}
captureMode: per-scene
intro: false
outro: false
mocks:
  - source: inline
    routes:
      "GET /api/me": { "name": "Alex" }
      "GET /api/projects": []
---

# first

\`\`\`playwright
await page.waitForSelector("body");
\`\`\`

---

# second

\`\`\`playwright
await page.waitForSelector("body");
\`\`\`
`);
      // Initial capture
      const { artifactsDir } = await capture({ demoFile, artifactsBase: tmp });
      const scenesDir = path.join(artifactsDir, "capture", "scenes");

      // Snapshot scene 0's webm hash (untouched after re-shoot)
      const crypto = await import("node:crypto");
      const scene0Path = path.join(scenesDir, "00-first", "page.webm");
      const scene0Before = crypto.createHash("sha256")
        .update(await fs.readFile(scene0Path))
        .digest("hex");

      // Tiny pause so any timestamp-derived bytes in scene 1 differ from the original
      await new Promise((r) => setTimeout(r, 50));

      // Re-shoot scene 1 only
      await capture({
        demoFile,
        onlyScene: 1,
        bundleDir: artifactsDir,
      });

      // Scene 0's bytes are unchanged
      const scene0After = crypto.createHash("sha256")
        .update(await fs.readFile(scene0Path))
        .digest("hex");
      expect(scene0After).toBe(scene0Before);

      // Scene 1's directory still exists with fresh artifacts
      const scene1Files = await fs.readdir(path.join(scenesDir, "01-second"));
      expect(scene1Files).toContain("page.webm");
      expect(scene1Files).toContain("events.json");

      // Manifest still has both scenes
      const manifest = JSON.parse(
        await fs.readFile(path.join(artifactsDir, "capture", "capture.json"), "utf8"),
      );
      expect(manifest.scenes).toHaveLength(2);
    } finally {
      await srv.close();
    }
  }, 120_000);

  it("rejects --scene re-shoot when the demo is in continuous mode", async () => {
    const srv = await startFixtureServer();
    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-reshoot-err-"));
      const demoFile = path.join(tmp, "demo.demo");
      await fs.writeFile(demoFile, `---
title: t
url: ${srv.url}
intro: false
outro: false
---

# only

\`\`\`playwright
await page.waitForSelector("body");
\`\`\`
`);
      await expect(
        capture({ demoFile, onlyScene: 0, bundleDir: tmp }),
      ).rejects.toThrow(/per-scene/);
    } finally {
      await srv.close();
    }
  }, 30_000);

  it("rejects --scene re-shoot without --bundle", async () => {
    const srv = await startFixtureServer();
    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-reshoot-err2-"));
      const demoFile = path.join(tmp, "demo.demo");
      await fs.writeFile(demoFile, `---
title: t
url: ${srv.url}
captureMode: per-scene
intro: false
outro: false
---

# only

\`\`\`playwright
await page.waitForSelector("body");
\`\`\`
`);
      await expect(
        capture({ demoFile, onlyScene: 0 }),
      ).rejects.toThrow(/--bundle/);
    } finally {
      await srv.close();
    }
  }, 30_000);

  it("writes per-scene clips into capture/scenes/<NN>-<slug>/ with their own page.webm + events.json", async () => {
    const srv = await startFixtureServer();
    try {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-ps-"));
      const demoFile = path.join(tmp, "demo.demo");
      await fs.writeFile(demoFile, `---
title: t
url: ${srv.url}
captureMode: per-scene
intro: false
outro: false
mocks:
  - source: inline
    routes:
      "GET /api/me": { "name": "Alex" }
      "GET /api/projects": []
---

# first

\`\`\`playwright
await page.waitForSelector("body");
\`\`\`

---

# second

\`\`\`playwright
await page.waitForSelector("body");
\`\`\`
`);
      const { artifactsDir } = await capture({ demoFile, artifactsBase: tmp });
      const scenesDir = path.join(artifactsDir, "capture", "scenes");
      const entries = (await fs.readdir(scenesDir)).sort();
      expect(entries).toEqual(["00-first", "01-second"]);
      for (const e of entries) {
        const files = await fs.readdir(path.join(scenesDir, e));
        expect(files).toContain("page.webm");
        expect(files).toContain("events.json");
      }

      // Unified events.json at the bundle root captures both scenes.
      const events = JSON.parse(
        await fs.readFile(path.join(artifactsDir, "capture", "events.json"), "utf8"),
      );
      const sceneStarts = events.filter((e: any) => e.kind === "scene_start");
      expect(sceneStarts).toHaveLength(2);
      // Second scene's t should be > first scene's t (time-shifted).
      expect(sceneStarts[1].t).toBeGreaterThanOrEqual(sceneStarts[0].t);

      // Manifest scene entries align with the directories.
      const manifest = JSON.parse(
        await fs.readFile(path.join(artifactsDir, "capture", "capture.json"), "utf8"),
      );
      expect(manifest.captureMode).toBe("per-scene");
      expect(manifest.scenes).toHaveLength(2);
      expect(manifest.scenes[0].slug).toBe("first");
      expect(manifest.scenes[1].slug).toBe("second");
    } finally {
      await srv.close();
    }
  }, 120_000);
});
