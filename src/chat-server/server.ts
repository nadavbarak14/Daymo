import http, { type Server, type IncomingMessage } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import { createIndexCache } from "./index-cache.js";
import { createRateLimiter } from "./rate-limit.js";
import { route } from "./router.js";
import { checkOrigin, corsHeaders } from "./cors.js";
import { handleChat } from "./handlers/chat.js";
import { handleWidgetConfig } from "./handlers/widget-config.js";
import { handleMp4 } from "./handlers/mp4.js";
import { handleAdminReload } from "./handlers/admin-reload.js";
import type { ChatRequest } from "../types.js";

export interface ServerOpts {
  port: number;
  host: string;
  dataRoot: string;
  anthropicClient: Anthropic;
  embedQueryFn: (text: string) => Promise<number[]>;
  baseUrl: string;
  rateLimitPerMinute?: number;
  maxResidentWidgets?: number;
  adminToken?: string;
}

async function readJson<T>(req: IncomingMessage, limit = 1_000_000): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export async function startServer(opts: ServerOpts): Promise<Server> {
  const cache = createIndexCache({ dataRoot: opts.dataRoot, maxResident: opts.maxResidentWidgets ?? 50 });
  const limiter = createRateLimiter({ maxPerMinute: opts.rateLimitPerMinute ?? 30 });

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const match = route(method, req.url ?? "/");
      const origin = req.headers.origin;

      if (match.handler.name === "preflight") {
        if (origin) {
          for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      if (match.handler.name === "not-found") {
        res.statusCode = 404;
        res.end();
        return;
      }

      if (match.handler.name === "admin-reload") {
        handleAdminReload(req, res, match.handler.widgetId, {
          invalidate: (id) => cache.invalidate(id),
          adminToken: opts.adminToken,
        });
        return;
      }

      if (match.handler.name === "mp4") {
        let entry;
        try {
          entry = await cache.load(match.handler.widgetId);
        } catch {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (origin && !checkOrigin(origin, entry.config.allowedOrigins)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (origin) for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
        await handleMp4(req, res, match.handler.widgetId, match.handler.demoId, { dataRoot: opts.dataRoot });
        return;
      }

      if (match.handler.name === "widget-config") {
        let entry;
        try {
          entry = await cache.load(match.handler.widgetId);
        } catch {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "widget not found" }));
          return;
        }
        if (!origin || !checkOrigin(origin, entry.config.allowedOrigins)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
        await handleWidgetConfig(req, res, match.handler.widgetId, { loadWidget: cache.load });
        return;
      }

      if (match.handler.name === "chat") {
        const body = await readJson<ChatRequest>(req).catch(() => null);
        if (!body || typeof body.widgetId !== "string") {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "invalid body" }));
          return;
        }
        let entry;
        try {
          entry = await cache.load(body.widgetId);
        } catch {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ kind: "no_match", text: "This help widget is not configured." }));
          return;
        }
        if (!origin || !checkOrigin(origin, entry.config.allowedOrigins)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const key = `${body.widgetId}:${clientIp(req)}`;
        const decision = limiter.check(key);
        if (!decision.allowed) {
          for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
          res.setHeader("Retry-After", String(decision.retryAfterSec));
          res.statusCode = 429;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "rate limit exceeded" }));
          return;
        }
        for (const [k, v] of Object.entries(corsHeaders(origin))) res.setHeader(k, v);
        await handleChat(req, res, body, {
          loadWidget: cache.load,
          anthropicClient: opts.anthropicClient,
          embedQueryFn: opts.embedQueryFn,
          baseUrl: opts.baseUrl,
        });
        return;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[chat-server] unhandled error:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "internal" }));
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, () => resolve()));
  return server;
}
