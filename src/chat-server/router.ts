export interface RouteMatch {
  handler:
    | { name: "chat" }
    | { name: "widget-config"; widgetId: string }
    | { name: "mp4"; widgetId: string; demoId: string }
    | { name: "admin-reload"; widgetId: string }
    | { name: "preflight" }
    | { name: "not-found" };
}

export function route(method: string, urlPath: string): RouteMatch {
  if (method === "OPTIONS") return { handler: { name: "preflight" } };
  const pathOnly = urlPath.split("?")[0];
  if (method === "POST" && pathOnly === "/chat") return { handler: { name: "chat" } };
  const wcfg = /^\/widget-config\/([A-Za-z0-9_-]+)$/.exec(pathOnly);
  if (method === "GET" && wcfg) return { handler: { name: "widget-config", widgetId: wcfg[1] } };
  const mp4 = /^\/widgets\/([A-Za-z0-9_-]+)\/demos\/([A-Za-z0-9_-]+)\/output\.mp4$/.exec(pathOnly);
  if (method === "GET" && mp4) return { handler: { name: "mp4", widgetId: mp4[1], demoId: mp4[2] } };
  if (method === "POST" && pathOnly === "/admin/reload") {
    const u = new URL(urlPath, "http://x");
    const widgetId = u.searchParams.get("widgetId");
    if (widgetId) return { handler: { name: "admin-reload", widgetId } };
  }
  return { handler: { name: "not-found" } };
}
