// tests/integration/server.ts
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.resolve(__dirname, "../fixtures/sample-app/index.html");

let _sampleServer: { url: string; close: () => Promise<void> } | null = null;

export async function startSampleApp(): Promise<string> {
  _sampleServer = await startFixtureServer();
  return _sampleServer.url;
}

export async function stopSampleApp(): Promise<void> {
  await _sampleServer?.close();
  _sampleServer = null;
}

export async function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const html = readFileSync(FIXTURE, "utf8");
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url?.startsWith("/index")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr !== "object" || !addr) throw new Error("listen failed");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
