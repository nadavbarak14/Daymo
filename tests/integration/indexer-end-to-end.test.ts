import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeIndexForDemoDir } from "../../src/indexer/write-index.js";

describe("writeIndexForDemoDir (integration with mocked Gemini)", () => {
  it("reads a demo dir + .daymo/ artifacts and writes index.json + config.json", async () => {
    const demoDir = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-idx-"));
    const daymoDir = path.join(demoDir, ".daymo");
    const capDir = path.join(daymoDir, "captures");
    await fs.mkdir(path.join(capDir, "scene-001"), { recursive: true });

    await fs.writeFile(path.join(demoDir, "tour.demo"), `---
title: Test Tour
description: Tour of test
url: http://localhost
---

# Welcome

\`\`\`playwright
await fx.say("Welcome to the dashboard.");
\`\`\`
`);

    await fs.writeFile(path.join(capDir, "scene-001", "events.json"), JSON.stringify([
      { kind: "scene_start", t: 0, index: 0, title: "Welcome", prose: "", recordingOffsetMs: 0 },
      { kind: "say", t: 200, hash: "h", text: "Welcome to the dashboard.", durationMs: 2000, words: [] },
      { kind: "scene_end", t: 3000, index: 0 },
    ]));

    await fs.writeFile(path.join(daymoDir, "step-index.json"), JSON.stringify({
      demoId: "tour",
      mp4DurationMs: 3000,
      scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 3000, recordingOffsetMs: 0 }],
      steps: [{ stepId: "tour:0:0", sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 3000 }],
    }));

    await fs.writeFile(path.join(demoDir, "output.mp4"), "");

    await fs.writeFile(path.join(daymoDir, "state.json"), JSON.stringify({
      scenes: [{ state: "captured", eventsPath: path.join(capDir, "scene-001", "events.json") }],
    }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embeddings: [{ values: Array(768).fill(0.5) }] }),
    });

    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-data-"));
    await writeIndexForDemoDir({
      demoDir,
      widgetId: "wgt_test",
      widgetName: "Test Helper",
      locale: "en",
      allowedOrigins: ["https://example.com"],
      dataRoot,
      geminiApiKey: "K",
      fetchFn: fetchMock,
    });

    const idx = JSON.parse(await fs.readFile(path.join(dataRoot, "widgets/wgt_test/index.json"), "utf8"));
    expect(idx.version).toBe("v1");
    expect(idx.widgetId).toBe("wgt_test");
    expect(idx.embeddingModel).toBe("gemini-embedding-001");
    expect(idx.embeddingDims).toBe(768);
    expect(idx.demos[0]).toMatchObject({ demoId: "tour", title: "Test Tour" });
    expect(idx.chunks).toHaveLength(1);
    expect(idx.chunks[0].text).toContain("Welcome to the dashboard.");

    const cfg = JSON.parse(await fs.readFile(path.join(dataRoot, "widgets/wgt_test/config.json"), "utf8"));
    expect(cfg.widgetId).toBe("wgt_test");
    expect(cfg.allowedOrigins).toEqual(["https://example.com"]);
  });

  it("indexes multiple demos in subfolders and copies each video into the widget dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-multi-"));

    // Scaffold one demo (its own .daymo + output.mp4 + captions.vtt) under a subfolder.
    async function scaffold(name: string, title: string, sayText: string) {
      const demoDir = path.join(root, name);
      const capDir = path.join(demoDir, ".daymo", "captures", "scene-001");
      await fs.mkdir(capDir, { recursive: true });
      await fs.writeFile(path.join(demoDir, `${name}.demo`), `---\ntitle: ${title}\ndescription: d\nurl: http://localhost\n---\n\n# S\n\n\`\`\`playwright\nawait fx.say("${sayText}");\n\`\`\`\n`);
      await fs.writeFile(path.join(capDir, "events.json"), JSON.stringify([
        { kind: "scene_start", t: 0, index: 0, title: "S", prose: "", recordingOffsetMs: 0 },
        { kind: "say", t: 200, hash: "h", text: sayText, durationMs: 2000, words: [] },
        { kind: "scene_end", t: 3000, index: 0 },
      ]));
      await fs.writeFile(path.join(demoDir, ".daymo", "step-index.json"), JSON.stringify({
        demoId: name,
        mp4DurationMs: 3000,
        scenes: [{ sceneIndex: 0, globalStartMs: 0, globalEndMs: 3000, recordingOffsetMs: 0 }],
        steps: [{ stepId: `${name}:0:0`, sceneIndex: 0, stepIndex: 0, description: "(preamble)", globalStartMs: 0, globalEndMs: 3000 }],
      }));
      await fs.writeFile(path.join(demoDir, ".daymo", "state.json"), JSON.stringify({
        scenes: [{ state: "captured", eventsPath: path.join(capDir, "events.json") }],
      }));
      await fs.writeFile(path.join(demoDir, "output.mp4"), `MP4:${name}`);
      await fs.writeFile(path.join(demoDir, "captions.vtt"), `WEBVTT ${name}`);
    }

    await scaffold("create-course", "Create a course", "Click new course.");
    await scaffold("share-course", "Share a course", "Click share.");

    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const n = (JSON.parse(init.body) as { requests?: unknown[] }).requests?.length ?? 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ embeddings: Array(n).fill({ values: Array(768).fill(0.1) }) }),
      };
    });

    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-data-"));
    await writeIndexForDemoDir({
      demoDir: root,
      widgetId: "wgt_multi",
      widgetName: "Multi",
      locale: "en",
      allowedOrigins: ["https://example.com"],
      dataRoot,
      geminiApiKey: "K",
      videoBaseUrl: "https://cdn/help/v1",
      fetchFn: fetchMock,
    });

    const idx = JSON.parse(await fs.readFile(path.join(dataRoot, "widgets/wgt_multi/index.json"), "utf8"));
    const ids = idx.demos.map((d: { demoId: string }) => d.demoId).sort();
    expect(ids).toEqual(["create-course", "share-course"]);
    expect(idx.chunks).toHaveLength(2);
    expect(idx.videoBaseUrl).toBe("https://cdn/help/v1");

    // Part 1: each demo's stitched video + captions copied where `publish` reads them.
    const widget = path.join(dataRoot, "widgets/wgt_multi/demos");
    expect(await fs.readFile(path.join(widget, "create-course/output.mp4"), "utf8")).toBe("MP4:create-course");
    expect(await fs.readFile(path.join(widget, "share-course/output.mp4"), "utf8")).toBe("MP4:share-course");
    expect(await fs.readFile(path.join(widget, "create-course/output.vtt"), "utf8")).toBe("WEBVTT create-course");
  });
});
