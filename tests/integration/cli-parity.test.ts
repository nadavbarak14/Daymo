import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { startEditor } from "../../src/editor/index.js";

const cliBin = path.resolve(__dirname, "../../dist/cli.js");

const tinyDemo = `---
title: tiny
url: about:blank
viewport: { width: 200, height: 200 }
---

# Scene one

\`\`\`playwright
await fx.say("hello");
await fx.pause(0.1);
\`\`\`
`;

async function tmpDemo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-parity-"));
  const file = path.join(dir, "tiny.demo");
  await fs.writeFile(file, tinyDemo);
  return file;
}

function postCapture(port: number, sceneIndex: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "localhost", port, path: `/api/capture/${sceneIndex}`, method: "POST" },
      (res) => {
        res.on("data", () => {});
        res.on("end", () =>
          res.statusCode === 202 ? resolve() : reject(new Error(`status ${res.statusCode}`)),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("CLI / editor parity", () => {
  it("editor capture and CLI capture produce identical events.json shapes", async () => {
    process.env.DAYMO_TTS_PROVIDER = "mock";
    const fileA = await tmpDemo();
    const fileB = await tmpDemo();

    // CLI path: spawn `daymo capture <fileA> --scene 1`
    await execa("node", [cliBin, "capture", fileA, "--scene", "1"], {
      env: { ...process.env, DAYMO_TTS_PROVIDER: "mock" },
    });
    const cliEventsPath = path.join(path.dirname(fileA), ".daymo/captures/scene-001.events.json");
    const cliEvents = JSON.parse(await fs.readFile(cliEventsPath, "utf8"));

    // Editor path: start in-process server, POST /api/capture/0, wait for completion
    const h = await startEditor({ demoFile: fileB, port: 0 });
    try {
      await postCapture(h.port, 0);
      const editorEventsPath = path.join(path.dirname(fileB), ".daymo/captures/scene-001.events.json");
      let tries = 0;
      while (tries++ < 60) {
        try {
          const events = JSON.parse(await fs.readFile(editorEventsPath, "utf8"));
          if (events.find((e: any) => e.kind === "scene_end")) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      await h.stop();
    }
    const editorEvents = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(fileB), ".daymo/captures/scene-001.events.json"),
        "utf8",
      ),
    );

    // Compare shape: same kinds in same order
    const cliKinds = cliEvents.map((e: any) => e.kind);
    const editorKinds = editorEvents.map((e: any) => e.kind);
    expect(editorKinds).toEqual(cliKinds);

    // Same say hash/text/durationMs (deterministic from input)
    const cliSay = cliEvents.find((e: any) => e.kind === "say");
    const editorSay = editorEvents.find((e: any) => e.kind === "say");
    expect(cliSay).toBeDefined();
    expect(editorSay).toBeDefined();
    expect(editorSay.hash).toBe(cliSay.hash);
    expect(editorSay.text).toBe(cliSay.text);
    expect(editorSay.durationMs).toBe(cliSay.durationMs);
  }, 120_000);
});
