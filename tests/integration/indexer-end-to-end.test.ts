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
});
