// tests/unit/editor-api.test.ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ServerResponse, IncomingMessage } from "node:http";
import {
  handleGetState,
  handleEvents,
  handleCapture,
  handleScript,
  handleStitch,
  notFound,
  methodNotAllowed,
  readJson,
} from "../../src/editor/api.js";
import { SseBus } from "../../src/editor/sse.js";
import type { EditorState } from "../../src/editor/types.js";

function makeRes() {
  const chunks: string[] = [];
  let head: { status: number; headers: Record<string, string> } | undefined;
  const res = {
    writeHead(s: number, h: Record<string, string>) { head = { status: s, headers: h }; return this; },
    write(c: string) { chunks.push(c); return true; },
    end(c?: string) { if (c !== undefined) chunks.push(c); },
    on() { return this; },
  } as unknown as ServerResponse;
  return {
    res,
    body: () => chunks.join(""),
    status: () => head?.status,
    contentType: () => head?.headers["content-type"],
  };
}

const sampleState: EditorState = {
  scenes: [
    { index: 0, title: "Scene one", state: "pending" },
    { index: 1, title: "Scene two", state: "ready" },
  ],
} as unknown as EditorState;

describe("editor/api: simple responders", () => {
  it("notFound writes 404 text/plain", () => {
    const r = makeRes();
    notFound(r.res);
    expect(r.status()).toBe(404);
    expect(r.contentType()).toBe("text/plain");
    expect(r.body()).toBe("not found");
  });

  it("methodNotAllowed writes 405 text/plain", () => {
    const r = makeRes();
    methodNotAllowed(r.res);
    expect(r.status()).toBe(405);
    expect(r.body()).toBe("method not allowed");
  });
});

describe("handleGetState", () => {
  it("returns 200 JSON of the current state", async () => {
    const r = makeRes();
    await handleGetState({ getState: () => sampleState, sse: new SseBus() }, r.res);
    expect(r.status()).toBe(200);
    expect(r.contentType()).toBe("application/json");
    expect(JSON.parse(r.body())).toEqual(sampleState);
  });
});

describe("handleEvents", () => {
  it("delegates to SseBus.attach", async () => {
    const sse = new SseBus();
    const spy = vi.spyOn(sse, "attach").mockImplementation(() => {});
    const r = makeRes();
    const req = new EventEmitter() as unknown as IncomingMessage;
    await handleEvents({ getState: () => sampleState, sse }, req, r.res);
    expect(spy).toHaveBeenCalledWith(r.res);
  });
});

describe("handleCapture", () => {
  const baseCtx = () => ({
    getState: () => sampleState,
    sse: new SseBus(),
    enqueueCapture: vi.fn(),
    sceneCount: () => 2,
  });

  it("returns 202 and enqueues for a valid scene index", async () => {
    const ctx = baseCtx();
    const r = makeRes();
    await handleCapture(ctx, 1, r.res);
    expect(r.status()).toBe(202);
    expect(JSON.parse(r.body())).toEqual({ ok: true });
    expect(ctx.enqueueCapture).toHaveBeenCalledWith(1);
  });

  it("returns 404 for negative indices and does not enqueue", async () => {
    const ctx = baseCtx();
    const r = makeRes();
    await handleCapture(ctx, -1, r.res);
    expect(r.status()).toBe(404);
    expect(JSON.parse(r.body())).toEqual({ error: "scene out of range" });
    expect(ctx.enqueueCapture).not.toHaveBeenCalled();
  });

  it("returns 404 when index >= sceneCount() and does not enqueue", async () => {
    const ctx = baseCtx();
    const r = makeRes();
    await handleCapture(ctx, 2, r.res);
    expect(r.status()).toBe(404);
    expect(ctx.enqueueCapture).not.toHaveBeenCalled();
  });
});

describe("handleScript", () => {
  it("returns 200 ok on successful rewrite", async () => {
    const ctx = {
      getState: () => sampleState,
      sse: new SseBus(),
      rewriteProse: vi.fn(async () => {}),
    };
    const r = makeRes();
    await handleScript(ctx, 0, { prose: "new prose" }, r.res);
    expect(r.status()).toBe(200);
    expect(JSON.parse(r.body())).toEqual({ ok: true });
    expect(ctx.rewriteProse).toHaveBeenCalledWith(0, "new prose");
  });

  it("returns 400 with the error message on failure", async () => {
    const ctx = {
      getState: () => sampleState,
      sse: new SseBus(),
      rewriteProse: vi.fn(async () => { throw new Error("scene not found"); }),
    };
    const r = makeRes();
    await handleScript(ctx, 9, { prose: "x" }, r.res);
    expect(r.status()).toBe(400);
    expect(JSON.parse(r.body())).toEqual({ error: "scene not found" });
  });
});

describe("handleStitch", () => {
  it("returns 409 listing 1-indexed pending scenes when any remain", async () => {
    const ctx = {
      getState: () => sampleState,
      sse: new SseBus(),
      stitchNow: vi.fn(async () => "/tmp/out.mp4"),
      pendingScenes: () => [0, 2],
    };
    const r = makeRes();
    await handleStitch(ctx, r.res);
    expect(r.status()).toBe(409);
    expect(JSON.parse(r.body())).toEqual({ error: "scenes not captured: 1, 3" });
    expect(ctx.stitchNow).not.toHaveBeenCalled();
  });

  it("returns 200 with output path when stitch succeeds", async () => {
    const ctx = {
      getState: () => sampleState,
      sse: new SseBus(),
      stitchNow: vi.fn(async () => "/tmp/out.mp4"),
      pendingScenes: () => [],
    };
    const r = makeRes();
    await handleStitch(ctx, r.res);
    expect(r.status()).toBe(200);
    expect(JSON.parse(r.body())).toEqual({ output: "/tmp/out.mp4" });
  });

  it("returns 500 with the error message when stitch throws", async () => {
    const ctx = {
      getState: () => sampleState,
      sse: new SseBus(),
      stitchNow: vi.fn(async () => { throw new Error("ffmpeg failed"); }),
      pendingScenes: () => [],
    };
    const r = makeRes();
    await handleStitch(ctx, r.res);
    expect(r.status()).toBe(500);
    expect(JSON.parse(r.body())).toEqual({ error: "ffmpeg failed" });
  });
});

describe("readJson", () => {
  it("parses a JSON request body", async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ foo: "bar", n: 1 }))]) as unknown as IncomingMessage;
    const out = await readJson<{ foo: string; n: number }>(req);
    expect(out).toEqual({ foo: "bar", n: 1 });
  });
});
