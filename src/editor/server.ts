import http, { type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { SseBus } from "./sse.js";
import type { EditorState } from "./types.js";
import { handleGetState, handleEvents, handleCapture, handleScript, handleStitch, handleStep, readJson, notFound } from "./api.js";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  let start: number;
  let end: number;
  if (startRaw === "" && endRaw === "") return null;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Number(endRaw);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

async function serveStatic(
  rootDir: string,
  urlPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const safeRel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(rootDir, safeRel));
  const rootResolved = path.resolve(rootDir);
  if (!path.resolve(filePath).startsWith(rootResolved)) {
    res.writeHead(403);
    res.end();
    return;
  }
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    if (urlPath.endsWith(".html") || !path.extname(urlPath)) {
      try {
        const data = await fs.readFile(path.join(rootResolved, "index.html"));
        res.writeHead(200, { "content-type": "text/html" });
        res.end(data);
        return;
      } catch {}
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] ?? "application/octet-stream";
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size);
    if (!range) {
      res.writeHead(416, {
        "content-type": "text/plain",
        "content-range": `bytes */${stat.size}`,
      });
      res.end("range not satisfiable");
      return;
    }
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      "content-type": contentType,
      "content-length": String(length),
      "content-range": `bytes ${range.start}-${range.end}/${stat.size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-cache",
    });
    const stream = createReadStream(filePath, { start: range.start, end: range.end });
    stream.on("error", () => res.end());
    stream.pipe(res);
    return;
  }
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": String(stat.size),
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
  });
  const stream = createReadStream(filePath);
  stream.on("error", () => res.end());
  stream.pipe(res);
}

export interface ServerOpts {
  port: number;
  sse: SseBus;
  getState: () => EditorState;
  enqueueCapture: (sceneIndex: number) => void;
  rewriteProse: (sceneIndex: number, prose: string) => Promise<void>;
  rewriteStep: (
    sceneIndex: number,
    stepIndex: number,
    kind: "description" | "say" | "banner" | "type",
    text: string,
    typeIndex?: number,
  ) => Promise<void>;
  stitchNow: () => Promise<string>;
  uiDir?: string;
  capturesDir: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export async function startServer(opts: ServerOpts): Promise<ServerHandle> {
  const ctx = { getState: opts.getState, sse: opts.sse };

  const srv = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/api/state" && req.method === "GET") return handleGetState(ctx, res);
      if (url.pathname === "/api/events" && req.method === "GET") return handleEvents(ctx, req, res);
      const m = url.pathname.match(/^\/api\/capture\/(\d+)$/);
      if (m && req.method === "POST") {
        return handleCapture(
          { ...ctx, enqueueCapture: opts.enqueueCapture, sceneCount: () => opts.getState().scenes.length },
          Number(m[1]),
          res,
        );
      }
      const sm = url.pathname.match(/^\/api\/script\/(\d+)$/);
      if (sm && req.method === "POST") {
        const body = await readJson<{ prose: string }>(req);
        return handleScript({ ...ctx, rewriteProse: opts.rewriteProse }, Number(sm[1]), body, res);
      }
      if (url.pathname === "/api/step" && req.method === "POST") {
        const body = await readJson<{ sceneIndex: number; stepIndex: number; kind: "description" | "say" | "banner" | "type"; text: string; typeIndex?: number }>(req);
        return handleStep(
          {
            ...ctx,
            rewriteStep: opts.rewriteStep,
            sceneCount: () => opts.getState().scenes.length,
          },
          body,
          res,
        );
      }
      if (url.pathname === "/api/stitch" && req.method === "POST") {
        return handleStitch(
          { ...ctx, stitchNow: opts.stitchNow, pendingScenes: () => opts.getState().scenes.flatMap((r, i) => r.state === "pending" ? [i] : []) },
          res,
        );
      }
      // Captures (always served from .daymo/captures/)
      if (url.pathname.startsWith("/captures/")) {
        const sub = url.pathname.slice("/captures/".length);
        return serveStatic(opts.capturesDir, "/" + sub, req, res);
      }

      // UI bundle (only if uiDir provided)
      if (opts.uiDir) {
        return serveStatic(opts.uiDir, url.pathname, req, res);
      }

      notFound(res);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end((e as Error).message);
    }
  });

  await new Promise<void>((resolve) => srv.listen(opts.port, "127.0.0.1", () => resolve()));
  const port = (srv.address() as { port: number }).port;
  return {
    url: `http://localhost:${port}`,
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        opts.sse.closeAll();
        srv.close(() => resolve());
      }),
  };
}
