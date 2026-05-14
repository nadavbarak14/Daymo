import { describe, it, expect } from "vitest";
import { createIndexCache } from "../../src/chat-server/index-cache.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IndexFile, WidgetConfig } from "../../src/types.js";

const makeIndex = (widgetId: string): IndexFile => ({
  version: "v1",
  widgetId,
  embeddingModel: "gemini-embedding-001",
  embeddingDims: 768,
  createdAt: "2026-05-14T00:00:00Z",
  etag: "x",
  demos: [],
  chunks: [],
});
const makeConfig = (widgetId: string): WidgetConfig => ({
  widgetId, name: "w", locale: "en", allowedOrigins: [], suggestedQuestions: [],
});

async function setupWidget(root: string, id: string) {
  await fs.mkdir(path.join(root, "widgets", id), { recursive: true });
  await fs.writeFile(path.join(root, "widgets", id, "index.json"), JSON.stringify(makeIndex(id)));
  await fs.writeFile(path.join(root, "widgets", id, "config.json"), JSON.stringify(makeConfig(id)));
}

describe("index cache", () => {
  it("loads index + config from disk on first call, then memoizes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    await setupWidget(root, "w1");
    const cache = createIndexCache({ dataRoot: root, maxResident: 5 });
    const r1 = await cache.load("w1");
    const r2 = await cache.load("w1");
    expect(r1.index.widgetId).toBe("w1");
    expect(r1.config.widgetId).toBe("w1");
    expect(r1).toBe(r2);
  });

  it("evicts least-recently-used when maxResident is exceeded", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    for (const id of ["a", "b", "c", "d"]) await setupWidget(root, id);
    const cache = createIndexCache({ dataRoot: root, maxResident: 2 });
    const a = await cache.load("a");
    await cache.load("b");
    await cache.load("c");
    const aReloaded = await cache.load("a");
    expect(aReloaded).not.toBe(a);
  });

  it("invalidate(widgetId) drops a single entry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    await setupWidget(root, "w1");
    const cache = createIndexCache({ dataRoot: root, maxResident: 5 });
    const r1 = await cache.load("w1");
    cache.invalidate("w1");
    const r2 = await cache.load("w1");
    expect(r2).not.toBe(r1);
  });

  it("throws a clean error when the widget is unknown", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    const cache = createIndexCache({ dataRoot: root, maxResident: 5 });
    await expect(cache.load("missing")).rejects.toThrow(/widget/i);
  });

  it("rejects index files whose version is not 'v1'", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cache-"));
    await fs.mkdir(path.join(root, "widgets", "w"), { recursive: true });
    await fs.writeFile(path.join(root, "widgets", "w", "index.json"), JSON.stringify({ ...makeIndex("w"), version: "v999" }));
    await fs.writeFile(path.join(root, "widgets", "w", "config.json"), JSON.stringify(makeConfig("w")));
    const cache = createIndexCache({ dataRoot: root, maxResident: 5 });
    await expect(cache.load("w")).rejects.toThrow(/version/i);
  });
});
