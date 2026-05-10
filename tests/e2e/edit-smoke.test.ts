import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { startSampleApp, stopSampleApp } from "../integration/server.js";
import { startEditor, type EditorHandle } from "../../src/editor/index.js";

let appUrl: string;
let h: EditorHandle;
let demoFile: string;
beforeAll(async () => { appUrl = await startSampleApp(); }, 30_000);
afterAll(async () => { await stopSampleApp(); await h?.stop(); });

describe("daymo edit smoke", () => {
  it("captures one scene and persists state.json", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-e2e-"));
    demoFile = path.join(tmp, "demo.demo");
    await fs.writeFile(demoFile, `---
title: T
url: ${appUrl}
---

# A

prose
`);
    h = await startEditor({ demoFile, port: 0 });

    // capture
    const r = await fetch(`${h.url}/api/capture/0`, { method: "POST" });
    expect(r.ok).toBe(true);

    // poll until captured
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const s = await (await fetch(`${h.url}/api/state`)).json();
      if (s.scenes[0].state === "captured") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const s = await (await fetch(`${h.url}/api/state`)).json();
    expect(s.scenes[0].state).toBe("captured");

    // state.json on disk after stop
    await h.stop();
    const json = JSON.parse(await fs.readFile(path.join(tmp, ".daymo/state.json"), "utf8"));
    expect(json.scenes[0].state).toBe("captured");
  }, 60_000);
});
