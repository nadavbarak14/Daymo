// Static server for the Daymo tour. Serves demo/app.html on :8765.
// Network calls (/api/me, /api/projects) are not handled here — Daymo intercepts
// them via the `mocks:` block in demo-tour.demo. Outside Daymo, the page's
// .catch fallbacks render empty.
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(path.join(__dirname, "demo/app.html"), "utf8");

const PORT = Number(process.env.PORT ?? 8765);

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url?.startsWith("/index")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`demo-server: http://127.0.0.1:${PORT}/`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
