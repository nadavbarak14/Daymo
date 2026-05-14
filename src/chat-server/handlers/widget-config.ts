import type { IncomingMessage, ServerResponse } from "node:http";
import type { CacheEntry } from "../index-cache.js";

export interface WidgetConfigDeps {
  loadWidget: (id: string) => Promise<CacheEntry>;
}

export async function handleWidgetConfig(
  _req: IncomingMessage,
  res: ServerResponse,
  widgetId: string,
  deps: WidgetConfigDeps,
): Promise<void> {
  try {
    const entry = await deps.loadWidget(widgetId);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      widgetId: entry.config.widgetId,
      name: entry.config.name,
      brandColor: entry.config.brandColor,
      locale: entry.config.locale,
      suggestedQuestions: entry.config.suggestedQuestions,
    }));
  } catch {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "widget not found" }));
  }
}
