// Local preview server for the Daymo help-center template.
//   node demo/help-server.mjs [port]
// Serves the demo page, the built dist module, the stylesheet, the design's
// real video/posters, a mock manifest, and a mock /chat endpoint that returns
// structured (text + cued-clip) answers — so the full UI is interactive.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // repo root
const PORT = Number(process.argv[2] || 5050);
const VIDEO = "/assets/sample-tour.mp4";

const sec = (s) => s * 1000;

// Mock manifest (mirrors the design's Aurelia jewelry guides).
const demos = [
  { demoId: "sizing", title: "Find your ring size", description: "Measure at home with the printable guide, or order a free sizer.", posterUrl: "/assets/poster-sizing.jpg", durationMs: sec(16), videoUrl: VIDEO,
    steps: [["Open the size guide on any ring page",6],["Print the chart at 100% scale",10],["Wrap an existing band to read the size",14],["Order a free sizer if unsure",18]] },
  { demoId: "tracking", title: "Track your order", description: "Find live tracking and your estimated delivery date in seconds.", posterUrl: "/assets/poster-tracking.jpg", durationMs: sec(16), videoUrl: VIDEO,
    steps: [["Sign in and open Orders",30],["Select the order you want",35],["Read live tracking + ETA",40]] },
  { demoId: "engraving", title: "Add custom engraving", description: "Personalize any piece with up to 12 characters before checkout.", posterUrl: "/assets/poster-engraving.jpg", durationMs: sec(18), videoUrl: VIDEO,
    steps: [["Add the piece to your bag",52],["Choose “Add engraving”",57],["Type up to 12 characters",62],["Preview, then check out",66]] },
  { demoId: "returns", title: "Start a return or exchange", description: "Free returns within 60 days — print a prepaid label and drop off.", posterUrl: "/assets/poster-returns.jpg", durationMs: sec(18), videoUrl: VIDEO,
    steps: [["Open Orders → Return",78],["Pick items and a reason",83],["Print the prepaid label",88],["Drop off at any carrier point",92]] },
  { demoId: "gift", title: "Choose gift wrap & delivery", description: "Add wrap, a handwritten note, and hide the price on the slip.", posterUrl: "/assets/poster-gift.jpg", durationMs: sec(18), videoUrl: VIDEO,
    steps: [["Toggle Gift options at checkout",100],["Select wrap style",105],["Write a gift note",110],["Hide price on the packing slip",114]] },
  { demoId: "care", title: "Caring for your jewelry", description: "Keep gold bright with a simple at-home cleaning routine.", posterUrl: "/assets/poster-care.jpg", durationMs: sec(18), videoUrl: VIDEO,
    steps: [["What to avoid day to day",6],["The 2-minute soak & brush",12],["When to book a pro polish",18]] },
].map((d) => ({ ...d, steps: d.steps.map(([label, t], i) => ({ stepId: `${d.demoId}:${i}`, label, startMs: sec(t) })) }));

const manifest = { version: "demo", videoBaseUrl: "/assets", demos };

// Mock chat knowledge base (keyword → structured answer).
const KB = [
  { k: ["ring size","size","sizing","fit","measure","resize"], demo: "sizing", clip: [6,22],
    text: "You can size at home in about a minute. Open the size guide on any ring page, print the chart at 100%, and wrap an existing band against it — or order a free sizer.", caption: "Find your ring size · cued 0:06" },
  { k: ["track","order","status","arrive","where is","where's","shipped","delivery"], demo: "tracking", clip: [30,46],
    text: "Everything lives under Orders. Sign in, open the order, and you'll see live carrier tracking plus the estimated delivery date right at the top.", caption: "Track your order · cued 0:30" },
  { k: ["engrav","custom","initials","personali","message","monogram"], demo: "engraving", clip: [52,70],
    text: "Most pieces can be engraved. Add the item to your bag, choose “Add engraving,” and type up to 12 characters — you'll see a live preview before you pay.", caption: "Add custom engraving · cued 0:52" },
  { k: ["return","exchange","refund","send back","doesn't fit","wrong size"], demo: "returns", clip: [78,96],
    text: "Returns are free within 60 days. Start one from Orders → Return, pick your items and a reason, print the prepaid label, and drop it at any carrier point.", caption: "Start a return · cued 1:18" },
  { k: ["gift","wrap","present","packaging","note","hide price"], demo: "gift", clip: [100,118],
    text: "At checkout, toggle Gift options to add wrap, write a handwritten note, and hide the price on the packing slip — perfect for sending straight to someone.", caption: "Gift wrap & delivery · cued 1:40" },
  { k: ["care","clean","polish","tarnish","maintain","scratch","bright","shower"], demo: "care", clip: [6,24],
    text: "Gold keeps its shine with a simple routine: avoid lotions and chlorine, do a quick 2-minute soak and soft-brush weekly, and book a pro polish once a year.", caption: "Caring for your jewelry · cued 0:06" },
];

function answer(message) {
  const s = String(message || "").toLowerCase();
  let best = null, score = 0;
  for (const e of KB) {
    const sc = e.k.filter((w) => s.includes(w)).length;
    if (sc > score) { score = sc; best = e; }
  }
  if (!best) {
    return { kind: "no_match", text: "I don't have a clip for that one yet — but here are the walkthroughs I can show you right now:",
      suggestions: ["How do I find my ring size?", "Where's my order?", "What's your return policy?"] };
  }
  return { kind: "answer", parts: [
    { kind: "text", text: best.text },
    { kind: "video", stepId: `${best.demo}:0`, demoId: best.demo, startMs: sec(best.clip[0]), endMs: sec(best.clip[1]),
      caption: best.caption, mp4Url: VIDEO },
  ] };
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".svg": "image/svg+xml" };

// Map a request path to a file on disk (allow-listed roots only).
function resolve(urlPath) {
  if (urlPath === "/" || urlPath === "") return join(ROOT, "demo/help/index.html");
  if (urlPath === "/help-center.css") return join(ROOT, "styles/help-center.css");
  if (urlPath.startsWith("/dist/")) return join(ROOT, normalize(urlPath));
  if (urlPath.startsWith("/assets/")) return join(ROOT, "demo/help", normalize(urlPath));
  return null;
}

async function serveFile(req, res, file) {
  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) { res.writeHead(404).end("Not found"); return; }
  const type = TYPES[extname(file)] || "application/octet-stream";
  const range = req.headers.range;
  if (range && type === "video/mp4") {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : info.size - 1;
    res.writeHead(206, {
      "content-type": type, "accept-ranges": "bytes",
      "content-range": `bytes ${start}-${end}/${info.size}`, "content-length": end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": info.size, "accept-ranges": "bytes" });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let message = "";
      try { message = JSON.parse(body).message; } catch { /* ignore */ }
      // small delay so the typing indicator is visible
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(answer(message)));
      }, 550);
    });
    return;
  }

  if (url.pathname === "/manifest.json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(manifest));
    return;
  }

  const file = resolve(url.pathname);
  if (!file) { res.writeHead(404).end("Not found"); return; }
  await serveFile(req, res, file);
}).listen(PORT, async () => {
  console.log(`Daymo help-center demo → http://localhost:${PORT}`);
  // The video/posters are BYO (gitignored). Warn if they're missing so the
  // page isn't silently blank.
  const sample = join(ROOT, "demo/help", VIDEO);
  const ok = await stat(sample).then(() => true).catch(() => false);
  if (!ok) {
    console.log(
      "\n⚠  demo/help/assets is empty. Drop a sample video at\n" +
        `   demo/help/assets/sample-tour.mp4 and posters poster-{sizing,tracking,\n` +
        "   engraving,returns,gift,care}.jpg (any 16:9 images) to see real media.\n" +
        "   The UI still renders without them.",
    );
  }
});
