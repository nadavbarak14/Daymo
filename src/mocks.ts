// src/mocks.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import type { MockSourceConfig, MockRouteResponse } from "./types.js";

export interface RouteEntry {
  method: string;
  urlGlob: string;          // e.g. "**/api/me"
  response: NormalizedResponse;
}

export interface NormalizedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export type FileLoader = (filePath: string) => Record<string, MockRouteResponse>;

const defaultLoader: FileLoader = (filePath) =>
  JSON.parse(readFileSync(filePath, "utf8")) as Record<string, MockRouteResponse>;

export function buildRouteTable(
  sources: MockSourceConfig[] | undefined,
  loader: FileLoader = defaultLoader,
  baseDir: string = process.cwd(),
): RouteEntry[] {
  const out: RouteEntry[] = [];
  for (const src of sources ?? []) {
    if (src.source !== "inline") continue;
    const routes: Record<string, MockRouteResponse> =
      src.routes ?? (src.file ? loader(path.resolve(baseDir, src.file)) : {});
    for (const [key, raw] of Object.entries(routes)) {
      const m = /^(\w+)\s+(.+)$/.exec(key);
      if (!m) throw new Error(`mock route key "${key}" must look like "METHOD /path"`);
      const method = m[1].toUpperCase();
      if (!VALID_METHODS.has(method)) throw new Error(`unknown HTTP method "${method}" in route "${key}"`);
      const urlPath = m[2].startsWith("/") ? m[2] : `/${m[2]}`;
      out.push({
        method,
        urlGlob: `**${urlPath}`,
        response: normalize(raw),
      });
    }
  }
  return out;
}

function normalize(raw: MockRouteResponse): NormalizedResponse {
  if (raw && typeof raw === "object" && "body" in (raw as object)) {
    const r = raw as { status?: number; headers?: Record<string, string>; body: unknown };
    return {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
      body: typeof r.body === "string" ? r.body : JSON.stringify(r.body),
    };
  }
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(raw),
  };
}

export async function attachMocks(page: Page, table: RouteEntry[]): Promise<void> {
  for (const entry of table) {
    await page.route(entry.urlGlob, async (route, req) => {
      if (req.method().toUpperCase() !== entry.method) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: entry.response.status,
        headers: entry.response.headers,
        body: entry.response.body,
      });
    });
  }
}
