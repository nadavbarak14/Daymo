import { put, list } from "@vercel/blob";
import type { CompanyConfig, IndexJson } from "../../../src/core/index-types.js";

const CACHE_MAX = 50;
const cache = new Map<string, { config?: CompanyConfig; index?: IndexJson; loadedAt: number }>();

function touch(companyId: string, patch: Partial<{ config: CompanyConfig; index: IndexJson }>) {
  const existing = cache.get(companyId) ?? { loadedAt: 0 };
  const next = { ...existing, ...patch, loadedAt: Date.now() };
  cache.delete(companyId);
  cache.set(companyId, next);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export async function getConfig(companyId: string): Promise<CompanyConfig | null> {
  const cached = cache.get(companyId);
  if (cached?.config) return cached.config;
  const url = `companies/${companyId}/config.json`;
  try {
    const res = await fetch(await blobPublicUrl(url));
    if (!res.ok) return null;
    const config = (await res.json()) as CompanyConfig;
    touch(companyId, { config });
    return config;
  } catch {
    return null;
  }
}

export async function getIndex(companyId: string): Promise<IndexJson | null> {
  const cached = cache.get(companyId);
  if (cached?.index) return cached.index;
  const url = `companies/${companyId}/index.json`;
  try {
    const res = await fetch(await blobPublicUrl(url));
    if (!res.ok) return null;
    const index = (await res.json()) as IndexJson;
    touch(companyId, { index });
    return index;
  } catch {
    return null;
  }
}

export function invalidate(companyId: string): void {
  cache.delete(companyId);
}

/** Resolve a Blob pathname to the canonical public URL.
 *  Vercel Blob URLs include a random suffix; we look up via list() at boot
 *  but for v1 we use a deterministic-prefix listing call. */
async function blobPublicUrl(pathname: string): Promise<string> {
  const { blobs } = await list({ prefix: pathname, limit: 1 });
  if (blobs.length === 0) throw new Error(`blob not found: ${pathname}`);
  return blobs[0].url;
}

export async function putConfig(companyId: string, config: CompanyConfig): Promise<void> {
  await put(`companies/${companyId}/config.json`, JSON.stringify(config, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
  invalidate(companyId);
}

export async function mp4Url(companyId: string, demoId: string): Promise<string> {
  return blobPublicUrl(`companies/${companyId}/demos/${demoId}/output.mp4`);
}
