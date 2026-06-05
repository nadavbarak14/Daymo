import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { publish } from "../../../src/publish/publish.js";
import type { Uploader } from "../../../src/publish/types.js";
import type { IndexFile } from "../../../src/types.js";

const index: IndexFile = {
  version: "v1",
  widgetId: "help",
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 2,
  videoBaseUrl: "https://cdn/help/v1",
  createdAt: "x",
  etag: "x",
  demos: [{ demoId: "d", title: "Create", description: "", durationMs: 9000 }],
  chunks: [{ stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 0, globalEndMs: 9, text: "click", embedding: [0, 1], keywords: ["click"] }],
};

describe("publish", () => {
  it("uploads manifest, index, and the demo video", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-publish-"));
    const wdir = path.join(root, "widgets", "help");
    await fs.mkdir(path.join(wdir, "demos", "d"), { recursive: true });
    await fs.writeFile(path.join(wdir, "index.json"), JSON.stringify(index));
    await fs.writeFile(path.join(wdir, "demos", "d", "output.mp4"), Buffer.from("FAKEMP4"));
    await fs.writeFile(path.join(wdir, "demos", "d", "poster.jpg"), Buffer.from("FAKEJPG"));

    const puts: string[] = [];
    const uploader: Uploader = { async put(key) { puts.push(key); } };

    const summary = await publish({ dataRoot: root, widgetId: "help", version: "v1", uploader });

    expect(puts).toContain("manifest.json");
    expect(puts).toContain("index.json");
    expect(puts).toContain("d/output.mp4");
    expect(puts).toContain("d/poster.jpg");
    expect(summary.videoCount).toBe(1);
    expect(summary.missingVideos).toEqual([]);
  });

  it("records missing videos without throwing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-publish-"));
    const wdir = path.join(root, "widgets", "help");
    await fs.mkdir(wdir, { recursive: true });
    await fs.writeFile(path.join(wdir, "index.json"), JSON.stringify(index));
    const uploader: Uploader = { async put() {} };

    const summary = await publish({ dataRoot: root, widgetId: "help", version: "v1", uploader });
    expect(summary.videoCount).toBe(0);
    expect(summary.missingVideos).toEqual(["d"]);
  });
});
