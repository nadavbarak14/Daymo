import fs from "node:fs/promises";
import path from "node:path";
import type { IndexFile, WidgetConfig, IndexedChunk } from "../types.js";

export interface CacheEntry {
  index: IndexFile;
  config: WidgetConfig;
  stepLookup: Map<string, IndexedChunk>;
}

export interface IndexCacheOpts {
  dataRoot: string;
  maxResident: number;
}

export function createIndexCache(opts: IndexCacheOpts): {
  load(widgetId: string): Promise<CacheEntry>;
  invalidate(widgetId: string): void;
} {
  const lru = new Map<string, CacheEntry>();

  async function loadFromDisk(widgetId: string): Promise<CacheEntry> {
    const dir = path.join(opts.dataRoot, "widgets", widgetId);
    let index: IndexFile;
    let config: WidgetConfig;
    try {
      index = JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8")) as IndexFile;
      config = JSON.parse(await fs.readFile(path.join(dir, "config.json"), "utf8")) as WidgetConfig;
    } catch (err) {
      throw new Error(`widget ${widgetId} not found in data root ${opts.dataRoot}: ${(err as Error).message}`);
    }
    if (index.version !== "v1") {
      throw new Error(`unsupported index version for widget ${widgetId}: ${index.version}`);
    }
    const stepLookup = new Map<string, IndexedChunk>();
    for (const c of index.chunks) stepLookup.set(c.stepId, c);
    return { index, config, stepLookup };
  }

  return {
    async load(widgetId: string): Promise<CacheEntry> {
      const existing = lru.get(widgetId);
      if (existing) {
        lru.delete(widgetId);
        lru.set(widgetId, existing);
        return existing;
      }
      const fresh = await loadFromDisk(widgetId);
      lru.set(widgetId, fresh);
      while (lru.size > opts.maxResident) {
        const oldest = lru.keys().next().value;
        if (oldest === undefined) break;
        lru.delete(oldest);
      }
      return fresh;
    },
    invalidate(widgetId: string): void {
      lru.delete(widgetId);
    },
  };
}
