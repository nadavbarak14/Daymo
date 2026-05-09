import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { startEditor, type EditorHandle } from "../../src/editor/index.js";
import { startSampleApp, stopSampleApp } from "./server.js";
import { EventSource } from "eventsource";

let h: EditorHandle;
let demoFile: string;

beforeAll(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-editor-"));
  demoFile = path.join(tmp, "demo.demo");
  await fs.writeFile(demoFile, `---
title: T
url: http://x
---

# A

prose A
`);
  h = await startEditor({ demoFile, port: 0 });
});

afterAll(async () => { await h?.stop(); });

describe("GET /api/state", () => {
  it("returns parsed scenes with pending state", async () => {
    const r = await fetch(`${h.url}/api/state`);
    const j = await r.json();
    expect(j.demoFile).toBe(demoFile);
    expect(j.scenes).toHaveLength(1);
    expect(j.scenes[0].state).toBe("pending");
    expect(j.scenes[0].title).toBe("A");
  });
});

describe("POST /api/capture/:n", () => {
  let appUrl: string;
  let h2: EditorHandle;
  beforeAll(async () => { appUrl = await startSampleApp(); }, 30_000);
  afterAll(async () => { await stopSampleApp(); await h2?.stop(); });

  it("captures a scene and emits capture-done via SSE", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cap-server-"));
    const file = path.join(tmp, "demo.demo");
    await fs.writeFile(file, `---
title: T
url: ${appUrl}
---

# A

prose
`);
    h2 = await startEditor({ demoFile: file, port: 0 });

    const events: any[] = [];
    const ev = new EventSource(`${h2.url}/api/events`);
    ev.onmessage = (m) => events.push(JSON.parse(m.data));
    await new Promise((r) => setTimeout(r, 50));

    const r = await fetch(`${h2.url}/api/capture/0`, { method: "POST" });
    expect(r.ok).toBe(true);

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (events.some((e) => e.type === "capture-done" && e.sceneIndex === 0)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(events.find((e) => e.type === "capture-done")).toBeTruthy();

    const state = await (await fetch(`${h2.url}/api/state`)).json();
    expect(state.scenes[0].state).toBe("captured");
    ev.close();
  }, 60_000);
});

describe("POST /api/approve/:n", () => {
  it("rejects approval when scene not captured", async () => {
    const r = await fetch(`${h.url}/api/approve/0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    expect(r.status).toBe(409);
  });
});

describe("POST /api/script/:n", () => {
  it("rewrites prose in the .demo file", async () => {
    const r = await fetch(`${h.url}/api/script/0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prose: "edited prose" }),
    });
    expect(r.ok).toBe(true);
    const text = await fs.readFile(demoFile, "utf8");
    expect(text).toContain("edited prose");
  });
});

describe("POST /api/stitch", () => {
  it("returns 409 when not all scenes approved", async () => {
    const r = await fetch(`${h.url}/api/stitch`, { method: "POST" });
    expect(r.status).toBe(409);
  });
});
