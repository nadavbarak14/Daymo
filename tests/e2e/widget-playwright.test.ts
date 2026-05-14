import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startServer } from "../../src/chat-server/server.js";
import { writeIndexForDemoDir } from "../../src/indexer/write-index.js";
import Anthropic from "@anthropic-ai/sdk";
import { embedQuery } from "../../src/indexer/embedder-gemini.js";

const run =
  process.env.RUN_LLM_TESTS === "1" &&
  process.env.RUN_EMBED_TESTS === "1" &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.GEMINI_API_KEY;

let browser: Browser;
let page: Page;
let backendServer: http.Server;
let staticServer: http.Server;
let dataRoot: string;
let backendPort: number;
let staticPort: number;

beforeAll(async () => {
  if (!run) return;
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-e2e-"));
  await writeIndexForDemoDir({
    demoDir: path.resolve("tests/fixtures/demo-chat/loomly"),
    widgetId: "fixture",
    widgetName: "Fixture",
    locale: "en",
    allowedOrigins: ["http://127.0.0.1:0"],
    dataRoot,
    geminiApiKey: process.env.GEMINI_API_KEY!,
  });

  staticServer = http.createServer(async (req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.setHeader("Content-Type", "text/html");
      res.end(await fs.readFile("tests/e2e/fixture-page.html"));
      return;
    }
    if (req.url === "/widget.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(await fs.readFile("dist-widget/widget.js"));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => staticServer.listen(0, "127.0.0.1", () => resolve()));
  staticPort = (staticServer.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${staticPort}`;

  await fs.writeFile(
    path.join(dataRoot, "widgets/fixture/config.json"),
    JSON.stringify(
      {
        widgetId: "fixture",
        name: "Fixture",
        locale: "en",
        allowedOrigins: [origin],
        suggestedQuestions: [],
      },
      null,
      2,
    ),
  );

  backendServer = await startServer({
    port: 0,
    host: "127.0.0.1",
    dataRoot,
    anthropicClient: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    embedQueryFn: (t) => embedQuery(t, { apiKey: process.env.GEMINI_API_KEY! }),
    baseUrl: "",
  });
  backendPort = (backendServer.address() as { port: number }).port;

  // Patch fixture-page.html in tmp to point at backend (via data-base-url)
  const pageHtml = (await fs.readFile("tests/e2e/fixture-page.html", "utf8")).replace(
    'data-widget-id="fixture"',
    `data-widget-id="fixture" data-base-url="http://127.0.0.1:${backendPort}"`,
  );
  await fs.writeFile(path.join(os.tmpdir(), "fixture-page-patched.html"), pageHtml);

  browser = await chromium.launch();
  page = await browser.newPage();
}, 120_000);

afterAll(async () => {
  if (!run) return;
  await browser?.close();
  await new Promise<void>((r) => backendServer.close(() => r()));
  await new Promise<void>((r) => staticServer.close(() => r()));
});

describe.skipIf(!run)("widget E2E", () => {
  it("opens the bubble, sends a question, renders an answer with a seeking video", async () => {
    await page.goto(`http://127.0.0.1:${staticPort}/`);
    await page.waitForSelector("#daymo-widget-root", { timeout: 10000 });

    // Playwright's `>>>` deep combinator pierces closed shadow DOM.
    await page.locator("css=#daymo-widget-root >>> .bubble").click();
    await page
      .locator("css=#daymo-widget-root >>> .input-row input")
      .fill("How do I create a project?");
    await page.locator("css=#daymo-widget-root >>> .input-row button").click();

    await page
      .locator("css=#daymo-widget-root >>> .msg-assistant video")
      .waitFor({ timeout: 15000 });

    const startSrc = await page
      .locator("css=#daymo-widget-root >>> video")
      .first()
      .getAttribute("src");
    expect(startSrc).toMatch(/#t=\d/);
  }, 60_000);
});
