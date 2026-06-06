import type { IndexFile } from "../types.js";

export interface IndexSourceOpts {
  /** Use this index object directly — skip any fetch. Pass it when you already
   *  have the index in memory (e.g. bundled or read elsewhere). */
  index?: IndexFile;
  /** Absolute base URL the published bundle lives under (the same prefix the
   *  manifest, index.json, and videos share). Falls back to the `HELP_BASE_URL`
   *  env var. When neither is set, the index is resolved same-origin relative
   *  to the incoming request (`<origin>/help/index.json`) — the zero-infra
   *  default where the bundle is served from the app's own `public/help/`. */
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Resolve the {@link IndexFile} for a chat request. `requestUrl` is the
 *  incoming request's URL, used only to derive the same-origin default when no
 *  explicit/env base URL is set. Host-agnostic: it relies on fetch, not on any
 *  platform's filesystem or bundling behaviour. */
export async function loadIndexSource(opts: IndexSourceOpts, requestUrl: string): Promise<IndexFile> {
  if (opts.index) return opts.index;
  const fetchFn = opts.fetchImpl ?? fetch;
  const rawBase = opts.baseUrl ?? process.env.HELP_BASE_URL ?? new URL("/help", requestUrl).toString();
  const base = rawBase.replace(/\/$/, "");
  const url = `${base}/index.json`;
  const res = await fetchFn(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`failed to load help index (${res.status}) from ${url}`);
  }
  return (await res.json()) as IndexFile;
}
