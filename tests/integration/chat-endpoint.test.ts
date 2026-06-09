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
    demos: [
      { demoId: "d", title: "D", description: "", durationMs: 10000 },
      { demoId: "d2", title: "D2", description: "", durationMs: 5000 },
    ],
    chunks: [
      {
        stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1,
        globalStartMs: 1000, globalEndMs: 2000,
        text: "[Demo] D\n[Scene] s\n[Step] Open dialog\nClick + New project.",
        embedding: [1, 0, 0], keywords: ["open", "dialog", "project", "new"],
      },
      {
        stepId: "d2:0:1", demoId: "d2", sceneIndex: 0, stepIndex: 1,
        globalStartMs: 500, globalEndMs: 1500,
        text: "[Demo] D2\n[Scene] s2\n[Step] Invite team\nInvite a team member.",
        embedding: [0, 1, 0], keywords: ["invite", "team"],
      },
    ],
  };
  const cfg: WidgetConfig = {
    widgetId: id, name: "T", locale: "en",
    allowedOrigins: ["https://example.com"], suggestedQuestions: ["Try one", "Try two"],
    noMatchText: "Custom no-match text.",
  };
  await fs.mkdir(path.join(dataRoot, "widgets", id, "demos", "d"), { recursive: true });
  await fs.mkdir(path.join(dataRoot, "widgets", id, "demos", "d2"), { recursive: true });
  await fs.writeFile(path.join(dataRoot, "widgets", id, "index.json"), JSON.stringify(idx));
  await fs.writeFile(path.join(dataRoot, "widgets", id, "config.json"), JSON.stringify(cfg));
  await fs.writeFile(path.join(dataRoot, "widgets", id, "demos", "d", "output.mp4"), "");
  await fs.writeFile(path.join(dataRoot, "widgets", id, "demos", "d2", "output.mp4"), "");
}

describe("POST /chat", () => {
  it("returns a structured answer when the LLM matches a chunk", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);

    const fakeEmbed = vi.fn().mockResolvedValue([1, 0, 0]);
    const fakeRewrite = vi.fn().mockResolvedValue({ queries: ["How do I open the dialog?"], catalogIntent: false });
    const fakeAnswer = vi.fn().mockResolvedValue({
      kind: "answer", parts: [
        { kind: "text", text: "Click + New project." },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "Open dialog", mp4Url: "" },
      ],
    });

    const server = await startServer({
      port: 0,
      host: "127.0.0.1",
      dataRoot,
      rewriteQueryFn: fakeRewrite,
      answerFn: fakeAnswer,
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

  it("returns no_match with retrievalConfidence:low when topCosineScore is below threshold", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);

    // Embedding orthogonal to all chunks → topCosine = 0 → retrievalConfidence = "low"
    const fakeEmbed = vi.fn().mockResolvedValue([0, 0, -1]);
    const fakeRewrite = vi.fn().mockResolvedValue({ queries: ["weird question"], catalogIntent: false });
    // answerFn IS called (confidence is a signal, never a gate); it returns no_match
    const fakeAnswer = vi.fn().mockResolvedValue({ kind: "no_match", text: "I don't know.", suggestions: [] });

    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      rewriteQueryFn: fakeRewrite, answerFn: fakeAnswer, embedQueryFn: fakeEmbed, baseUrl: "https://daymo.dev",
    });
    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "weird question", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(200);
    expect(JSON.parse(resp.body).kind).toBe("no_match");
    // answerFn was called with retrievalConfidence: "low" (signal, not a gate)
    expect(fakeAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ retrievalConfidence: "low" }),
    );
    server.close();
  });

  it("returns 403 when Origin is not in the allowlist", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);
    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      rewriteQueryFn: vi.fn(), answerFn: vi.fn(),
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
      rewriteQueryFn: vi.fn(), answerFn: vi.fn(),
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
    const fakeRewrite = vi.fn().mockResolvedValue({ queries: ["x"], catalogIntent: false });
    const fakeAnswer = vi.fn().mockResolvedValue({ kind: "no_match", text: "x" });
    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      rewriteQueryFn: fakeRewrite, answerFn: fakeAnswer, embedQueryFn: fakeEmbed, baseUrl: "https://x",
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

  it("passes a catalog-intent chunk for every demo when rewrite returns catalogIntent:true", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);

    const fakeEmbed = vi.fn().mockResolvedValue([0, 0, 1]);
    // catalogIntent: true → handler injects first chunk of each demo
    const fakeRewrite = vi.fn().mockResolvedValue({ queries: ["show me everything"], catalogIntent: true });
    const fakeAnswer = vi.fn().mockResolvedValue({
      kind: "answer",
      parts: [
        { kind: "text", text: "Here are all the demos." },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "Open dialog", mp4Url: "" },
        { kind: "video", stepId: "d2:0:1", demoId: "d2", startMs: 500, endMs: 1500, caption: "Invite team", mp4Url: "" },
      ],
    });

    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      rewriteQueryFn: fakeRewrite, answerFn: fakeAnswer, embedQueryFn: fakeEmbed,
      baseUrl: "https://daymo.dev",
    });

    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "show me everything", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(200);

    // answerFn must have received chunks for BOTH demos (catalogIntent injection)
    const callChunks = fakeAnswer.mock.calls[0][0].chunks as Array<{ demoId: string }>;
    const demoIds = callChunks.map((c) => c.demoId);
    expect(demoIds).toContain("d");
    expect(demoIds).toContain("d2");

    server.close();
  });

  it("returns canned no-match text (not empty string) when answerFn returns hard-failure marker", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-chat-"));
    await setupWidget(dataRoot);

    const fakeEmbed = vi.fn().mockResolvedValue([1, 0, 0]);
    const fakeRewrite = vi.fn().mockResolvedValue({ queries: ["x"], catalogIntent: false });
    // Hard-failure marker: kind=no_match with empty text
    const fakeAnswer = vi.fn().mockResolvedValue({ kind: "no_match", text: "" });

    const server = await startServer({
      port: 0, host: "127.0.0.1", dataRoot,
      rewriteQueryFn: fakeRewrite, answerFn: fakeAnswer, embedQueryFn: fakeEmbed,
      baseUrl: "https://daymo.dev",
    });

    const resp = await postJson(
      (server.address() as { port: number }).port,
      "/chat",
      { widgetId: "wgt_test", message: "x", history: [] },
      { Origin: "https://example.com" },
    );
    expect(resp.status).toBe(200);
    const body = JSON.parse(resp.body);
    expect(body.kind).toBe("no_match");
    // Must use the config's noMatchText, NOT the empty string
    expect(body.text).toBe("Custom no-match text.");
    expect(body.text).not.toBe("");
    // Suggestions come from suggestedQuestions
    expect(Array.isArray(body.suggestions)).toBe(true);
    expect(body.suggestions.length).toBeGreaterThan(0);

    server.close();
  });
});
