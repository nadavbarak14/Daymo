import type { IncomingMessage, ServerResponse } from "node:http";

export interface AdminReloadDeps {
  invalidate: (widgetId: string) => void;
  adminToken: string | undefined;
}

export function handleAdminReload(
  req: IncomingMessage,
  res: ServerResponse,
  widgetId: string,
  deps: AdminReloadDeps,
): void {
  if (!deps.adminToken) {
    res.statusCode = 503;
    res.end("admin token not configured");
    return;
  }
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${deps.adminToken}`) {
    res.statusCode = 401;
    res.end();
    return;
  }
  deps.invalidate(widgetId);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, invalidated: widgetId }));
}
