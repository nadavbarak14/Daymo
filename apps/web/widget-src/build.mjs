import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(__dirname, "widget.ts")],
  bundle: true,
  format: "iife",
  target: ["es2020"],
  minify: true,
  outfile: path.join(__dirname, "..", "public", "widget.js"),
  loader: { ".ts": "ts" },
});

console.log("daymo widget bundle: built apps/web/public/widget.js");
