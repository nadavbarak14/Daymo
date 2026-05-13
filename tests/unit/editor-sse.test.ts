// tests/unit/editor-sse.test.ts
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { SseBus } from "../../src/editor/sse.js";

// Minimal ServerResponse stub: captures writeHead args, write chunks, end calls,
// and supports the "close" event so SseBus's cleanup can fire.
function makeRes() {
  const ee = new EventEmitter();
  const chunks: string[] = [];
  let head: { status: number; headers: Record<string, string> } | undefined;
  let ended = false;
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      head = { status, headers };
      return this;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
    on(evt: string, cb: () => void) {
      ee.on(evt, cb);
      return this;
    },
    emit(evt: string) {
      ee.emit(evt);
    },
  } as unknown as ServerResponse & { emit(evt: string): void };
  return { res, chunks, getHead: () => head, isEnded: () => ended };
}

describe("SseBus", () => {
  it("attach() sends SSE headers and a connection comment", () => {
    const bus = new SseBus();
    const { res, chunks, getHead } = makeRes();
    bus.attach(res);
    expect(getHead()?.status).toBe(200);
    expect(getHead()?.headers["content-type"]).toBe("text/event-stream");
    expect(getHead()?.headers["cache-control"]).toBe("no-cache");
    expect(chunks[0]).toBe(": connected\n\n");
  });

  it("publish() formats events as `data: <json>\\n\\n` to every attached client", () => {
    const bus = new SseBus();
    const a = makeRes();
    const b = makeRes();
    bus.attach(a.res);
    bus.attach(b.res);

    bus.publish({ type: "scene-captured", index: 2 });

    // Each client got the initial ": connected\n\n" plus the data frame.
    expect(a.chunks).toContain(`data: {"type":"scene-captured","index":2}\n\n`);
    expect(b.chunks).toContain(`data: {"type":"scene-captured","index":2}\n\n`);
  });

  it("drops a client when its response emits 'close'", () => {
    const bus = new SseBus();
    const a = makeRes();
    const b = makeRes();
    bus.attach(a.res);
    bus.attach(b.res);

    // Simulate client A disconnecting.
    (a.res as unknown as { emit(e: string): void }).emit("close");

    bus.publish({ type: "ping" });

    // B got it, A did not (only its initial connect comment).
    expect(b.chunks.some((c) => c.startsWith("data:"))).toBe(true);
    expect(a.chunks.some((c) => c.startsWith("data:"))).toBe(false);
  });

  it("closeAll() ends every client response and clears the set", () => {
    const bus = new SseBus();
    const a = makeRes();
    const b = makeRes();
    bus.attach(a.res);
    bus.attach(b.res);

    bus.closeAll();
    expect(a.isEnded()).toBe(true);
    expect(b.isEnded()).toBe(true);

    // After closeAll, publish should be a no-op (no one to write to).
    const beforeA = a.chunks.length;
    const beforeB = b.chunks.length;
    bus.publish({ type: "after-close" });
    expect(a.chunks.length).toBe(beforeA);
    expect(b.chunks.length).toBe(beforeB);
  });
});
