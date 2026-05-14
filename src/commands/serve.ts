import path from "node:path";
import os from "node:os";
import { startServer } from "../chat-server/server.js";
import { embedQuery } from "../indexer/embedder-gemini.js";
import { rewriteQuery, answerWithChunks } from "../chat-server/llm.js";

export interface ServeOpts {
  port?: number;
  host?: string;
  dataRoot?: string;
  baseUrl?: string;
  rateLimitPerMinute?: number;
  adminToken?: string;
}

export async function serveCommand(opts: ServeOpts): Promise<void> {
  const dataRoot = opts.dataRoot
    ?? process.env.DAYMO_DATA_ROOT
    ?? path.join(os.homedir(), ".daymo-chat-data");
  const port = opts.port ?? 8765;
  const host = opts.host ?? "127.0.0.1";
  const baseUrl = opts.baseUrl ?? `http://${host}:${port}`;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("GEMINI_API_KEY is required to run `daymo serve`.");

  const server = await startServer({
    port,
    host,
    dataRoot,
    rewriteQueryFn: (input) => rewriteQuery(input, { apiKey: geminiKey }),
    answerFn: (input) => answerWithChunks(input, { apiKey: geminiKey }),
    embedQueryFn: (text) => embedQuery(text, { apiKey: geminiKey }),
    baseUrl,
    rateLimitPerMinute: opts.rateLimitPerMinute,
    adminToken: opts.adminToken ?? process.env.DAYMO_ADMIN_TOKEN,
  });
  const addr = server.address();
  if (addr && typeof addr === "object") {
    process.stdout.write(`daymo serve listening on http://${host}:${addr.port}\n`);
    process.stdout.write(`data-root: ${dataRoot}\n`);
  }
}
