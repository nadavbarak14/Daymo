import path from "node:path";
import os from "node:os";
import { writeIndexForDemoDir } from "../indexer/write-index.js";

export interface IndexCommandOpts {
  widgetId: string;
  widgetName?: string;
  locale?: string;
  allowedOrigins?: string;
  brandColor?: string;
  dataRoot?: string;
}

export async function indexCommand(demoDir: string, opts: IndexCommandOpts): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required for `daymo index`.");
  }
  const dataRoot = opts.dataRoot
    ?? process.env.DAYMO_DATA_ROOT
    ?? path.join(os.homedir(), ".daymo-chat-data");
  const allowedOrigins = (opts.allowedOrigins ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowedOrigins.length === 0) {
    throw new Error("--allowed-origins is required (comma-separated list of exact origins).");
  }
  await writeIndexForDemoDir({
    demoDir: path.resolve(demoDir),
    widgetId: opts.widgetId,
    widgetName: opts.widgetName ?? opts.widgetId,
    locale: opts.locale ?? "en",
    allowedOrigins,
    brandColor: opts.brandColor,
    dataRoot,
    geminiApiKey: apiKey,
  });
  process.stdout.write(`indexed -> ${path.join(dataRoot, "widgets", opts.widgetId)}\n`);
}
