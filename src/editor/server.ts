import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { SseBus } from "./sse.js";
import type { EditorState } from "./types.js";
import { handleGetState, handleEvents, handleCapture, handleApprove, handleScript, handleStitch, readJson, notFound } from "./api.js";

export interface ServerOpts {
  port: number;
  sse: SseBus;
  getState: () => EditorState;
  enqueueCapture: (sceneIndex: number) => void;
  approve: (sceneIndex: number, approved: boolean) => void;
  rewriteProse: (sceneIndex: number, prose: string) => Promise<void>;
  stitchNow: () => Promise<string>;
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
      const am = url.pathname.match(/^\/api\/approve\/(\d+)$/);
      if (am && req.method === "POST") {
        const body = await readJson<{ approved: boolean }>(req);
        return handleApprove({ ...ctx, approve: opts.approve }, Number(am[1]), body, res);
      }
      const sm = url.pathname.match(/^\/api\/script\/(\d+)$/);
      if (sm && req.method === "POST") {
        const body = await readJson<{ prose: string }>(req);
        return handleScript({ ...ctx, rewriteProse: opts.rewriteProse }, Number(sm[1]), body, res);
      }
      if (url.pathname === "/api/stitch" && req.method === "POST") {
        return handleStitch(
          { ...ctx, stitchNow: opts.stitchNow, allApproved: () => opts.getState().allApproved },
          res,
        );
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
