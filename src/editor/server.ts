import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { SseBus } from "./sse.js";
import type { EditorState } from "./types.js";
import { handleGetState, handleEvents, notFound } from "./api.js";

export interface ServerOpts {
  port: number;
  sse: SseBus;
  getState: () => EditorState;
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
