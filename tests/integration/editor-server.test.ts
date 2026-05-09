import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { startEditor, type EditorHandle } from "../../src/editor/index.js";

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
