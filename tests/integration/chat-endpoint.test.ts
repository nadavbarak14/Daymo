import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../../src/chat-server/server.js";
import type { IndexFile, WidgetConfig } from "../../src/types.js";

async function postJson(port: number, urlPath: string, body: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1", port, path: urlPath, method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "1.2.3.4", ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function setupWidget(dataRoot: string) {
  const id = "wgt_test";
  const idx: IndexFile = {
    version: "v1", widgetId: id,
    embeddingModel: "gemini-embedding-001", embeddingDims: 3,
    createdAt: "2026-05-14T00:00:00Z", etag: "x",
    demos: [{ demoId: "d", title: "D", description: "", durationMs: 10000 }],
    chunks: [
      {
        stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1,
        globalStartMs: 1000, globalEndMs: 2000,
        text: "[Demo] D\n[Scene] s\n[Step] Open dialog\nClick + New project.",
        embedding: [1, 0, 0], keywords: ["open", "dialog", "project", "new"],
      },
    ],
  };
  const cfg: WidgetConfig = {
    widgetId: id, name: "T", locale: "en",
    allowedOrigins: ["https://example.com"], suggestedQuestions: [],
  };
  await fs.mkdir(path.join(dataRoot, "widgets", id, "demos", "d"), { recursive: true });
  await fs.writeFile(path.join(dataRoot, "widgets", id, "index.json"), JSON.stringify(idx));
  await fs.writeFile(path.join(dataRoot, "widgets", id, "config.json"), JSON.stringify(cfg));
  await fs.writeFile(path.join(dataRoot, "widgets", id, "demos", "d", "output.mp4"), "");
}

describe("POST /chat", () => {
  it("returns a structured answer when the LLM matches a chunk", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);

    const fakeEmbed = vi.fn().mockResolvedValue([1, 0, 0]);
    const fakeLLM = {
      messages: {
        create: vi.fn().mockResolvedValueOnce({
          content: [{ type: "text", text: JSON.stringify({
            kind: "answer", parts: [
              { kind: "text", text: "Click + New project." },
              { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "Open dialog", mp4Url: "" },
            ],
          }) }],
        }),
      },
    };

    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      dataRoot,
      anthropicClient: fakeLLM as never,
      embedQueryFn: fakeEmbed,
      baseUrl: "https://daymo.dev",
    });

    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "how do I X?", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.kind).toBe("answer");
    const video = body.parts.find((p: { kind: string }) => p.kind === "video");
    expect(video.mp4Url).toBe("https://daymo.dev/widgets/wgt_test/demos/d/output.mp4");

    server.close();
  });

  it("returns no_match when topCosineScore is below 0.55", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);

    const fakeEmbed = vi.fn().mockResolvedValue([0, 1, 0]);
    const fakeLLM = {
      messages: { create: vi.fn().mockResolvedValueOnce({ content: [{ type: "text", text: "weird question" }] }) },
    };

    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      anthropicClient: fakeLLM as never, embedQueryFn: fakeEmbed, baseUrl: "https://daymo.dev",
    });
    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "weird question", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(200);
    expect(JSON.parse(resp.body).kind).toBe("no_match");
    server.close();
  });

  it("returns 403 when Origin is not in the allowlist", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);
    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      anthropicClient: { messages: { create: vi.fn() } } as never,
      embedQueryFn: vi.fn(), baseUrl: "https://x",
    });
    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "x", history: [] },
      { Origin: "https://evil.example.com" },
    );
    expect(resp.status).toBe(403);
    server.close();
  });

  it("returns 404 when widgetId is unknown", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);
    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      anthropicClient: { messages: { create: vi.fn() } } as never,
      embedQueryFn: vi.fn(), baseUrl: "https://x",
    });
    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "no_such", message: "x", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(404);
    server.close();
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);
    const fakeEmbed = vi.fn().mockResolvedValue([0, 1, 0]);
    const fakeLLM = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "x" }] }) },
    };
    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      anthropicClient: fakeLLM as never, embedQueryFn: fakeEmbed, baseUrl: "https://x",
      rateLimitPerMinute: 2,
    });
    const port = (server.address() as { port: number }).port;
    for (let i = 0; i < 2; i++) {
      const ok = await postJson(port, "/chat", { widgetId: "wgt_test", message: "x", history: [] }, { Origin: "https://example.com" });
      expect(ok.status).toBe(200);
    }
    const overLimit = await postJson(port, "/chat", { widgetId: "wgt_test", message: "x", history: [] }, { Origin: "https://example.com" });
    expect(overLimit.status).toBe(429);
    expect(overLimit.headers["retry-after"]).toBeDefined();
    server.close();
  });
});
