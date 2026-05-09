import type { IncomingMessage, ServerResponse } from "node:http";
import type { EditorState } from "./types.js";
import type { SseBus } from "./sse.js";

export interface ApiCtx {
  getState(): EditorState;
  sse: SseBus;
}

export async function handleGetState(ctx: ApiCtx, res: ServerResponse): Promise<void> {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(ctx.getState()));
}

export async function handleEvents(ctx: ApiCtx, _req: IncomingMessage, res: ServerResponse): Promise<void> {
  ctx.sse.attach(res);
}

export function notFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

export function methodNotAllowed(res: ServerResponse): void {
  res.writeHead(405, { "content-type": "text/plain" });
  res.end("method not allowed");
}
