import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";

await build({
  entryPoints: [path.join(__dirname, "src/widget.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: isProd,
  sourcemap: !isProd,
  outfile: path.join(__dirname, "..", "dist-widget/widget.js"),
  loader: { ".css": "text", ".json": "json" },
  define: { "globalThis.__DAYMO_WIDGET_VERSION__": JSON.stringify(process.env.npm_package_version ?? "0.0.0") },
  logLevel: "info",
});
