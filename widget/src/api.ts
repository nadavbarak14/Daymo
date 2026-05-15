import type { ChatRequest, ChatResponse, WidgetConfigResp } from "./types.js";

export class ApiError extends Error {
  constructor(public status: number, public retryAfterSec: number, message: string) {
    super(message);
  }
}

export interface ApiOpts {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

async function callWithRetry<T>(doIt: () => Promise<Response>, parseOk: (r: Response) => Promise<T>): Promise<T> {
  let lastErr: ApiError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await doIt();
    if (res.ok) return parseOk(res);
    const retryAfterHeader = res.headers.get?.("Retry-After") ?? null;
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : 0;
    lastErr = new ApiError(res.status, retryAfterSec, `HTTP ${res.status}`);
    if (res.status !== 502) throw lastErr;
  }
  throw lastErr;
}

export function createApi(opts: ApiOpts) {
  const fetchFn = opts.fetchFn ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
      return callWithRetry(
        () => fetchFn(`${base}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        }),
        (r) => r.json() as Promise<ChatResponse>,
      );
    },
    async getConfig(widgetId: string): Promise<WidgetConfigResp> {
      return callWithRetry(
        () => fetchFn(`${base}/widget-config/${encodeURIComponent(widgetId)}`),
        (r) => r.json() as Promise<WidgetConfigResp>,
      );
    },
  };
}
