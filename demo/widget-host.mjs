// Serves the Loomly demo product page on :9000 with the chat widget injected,
// plus the bundled widget.js and the mock /api/* routes the Loomly app expects.
//
// The widget posts to a separate chat backend on :8766 — configured via the
// data-base-url attribute on the script tag.
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const RAW_HTML = readFileSync(path.join(__dirname, "app.html"), "utf8");
const APP_HTML = RAW_HTML.replace(
  "</body>",
  `  <script async src="/widget.js" data-widget-id="loomly" data-base-url="http://127.0.0.1:8766"></script>\n</body>`,
);

const WIDGET_JS = readFileSync(path.join(ROOT, "dist-widget/widget.js"), "utf8");

const PROJECTS = [
  { name: "Acme rebrand", description: "Refresh the marketing site for the new identity.", owner: "Priya", status: "in-progress", due: "Fri" },
  { name: "Q3 launch plan", description: "Coordinate the multi-team launch of the v3 release.", owner: "Marco", status: "at-risk", due: "Aug 9" },
  { name: "Pricing experiment", description: "Test usage-based tier vs. flat seat pricing.", owner: "Yumi", status: "shipped", due: "shipped" },
];

const server = http.createServer((req, res) => {
  if (req.url === "/widget.js") {
    res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
    res.end(WIDGET_JS);
    return;
  }
  if (req.url === "/api/me") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ name: "Alex Chen" }));
    return;
  }
  if (req.url === "/api/projects") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(PROJECTS));
    return;
  }
  if (req.url === "/" || req.url?.startsWith("/index")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(APP_HTML);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
});

const PORT = Number(process.env.PORT ?? 9000);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`widget-host: http://127.0.0.1:${PORT}/`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
