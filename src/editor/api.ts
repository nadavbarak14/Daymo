import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";
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

export interface CaptureCtx extends ApiCtx {
  enqueueCapture(sceneIndex: number): void;
  sceneCount(): number;
}

export async function handleCapture(ctx: CaptureCtx, sceneIndex: number, res: ServerResponse): Promise<void> {
  if (sceneIndex < 0 || sceneIndex >= ctx.sceneCount()) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "scene out of range" }));
    return;
  }
  ctx.enqueueCapture(sceneIndex);
  res.writeHead(202, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const c of req as unknown as Readable) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export interface ScriptCtx extends ApiCtx {
  rewriteProse(sceneIndex: number, prose: string): Promise<void>;
}

export async function handleScript(
  ctx: ScriptCtx,
  sceneIndex: number,
  body: { prose: string },
  res: ServerResponse,
): Promise<void> {
  try {
    await ctx.rewriteProse(sceneIndex, body.prose);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}

export interface StitchCtx extends ApiCtx {
  stitchNow(): Promise<string>;
  pendingScenes(): number[]; // 0-indexed scene indices that are still "pending"
}

export async function handleStitch(ctx: StitchCtx, res: ServerResponse): Promise<void> {
  const pending = ctx.pendingScenes();
  if (pending.length > 0) {
    res.writeHead(409, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `scenes not captured: ${pending.map((i) => i + 1).join(", ")}` }));
    return;
  }
  try {
    const output = await ctx.stitchNow();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ output }));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}

export interface StepCtx extends ApiCtx {
  rewriteStep(
    sceneIndex: number,
    stepIndex: number,
    kind: "description" | "say" | "banner",
    text: string,
  ): Promise<void>;
  sceneCount(): number;
}

export interface StepBody {
  sceneIndex: number;
  stepIndex: number;
  kind: "description" | "say" | "banner";
  text: string;
}

export async function handleStep(
  ctx: StepCtx,
  body: StepBody,
  res: ServerResponse,
): Promise<void> {
  if (body.sceneIndex < 0 || body.sceneIndex >= ctx.sceneCount()) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "scene out of range" }));
    return;
  }
  if (!body.kind || (body.kind !== "description" && body.kind !== "say" && body.kind !== "banner")) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid kind" }));
    return;
  }
  try {
    await ctx.rewriteStep(body.sceneIndex, body.stepIndex, body.kind, body.text);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
