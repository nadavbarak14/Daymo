import fs from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob/client";
import { parse } from "../parser.js";
import { buildIndex, type DemoInput } from "../core/indexer.js";
import { realGeminiEmbedder } from "../core/gemini-embed.js";
import type { StepIndex, RunnerEvent } from "../types.js";
import type {
  PublishBeginRequest, PublishBeginResponse,
  PublishFinalizeRequest, PublishFinalizeResponse,
} from "../core/publish-contract.js";

export interface PublishFlags {
  company: string;
  name?: string;
  brandColor?: string;
  locale?: string;
  allowedOrigin?: string[];
  endpoint?: string;
  token?: string;
}

export async function publishCommand(input: string, flags: PublishFlags): Promise<void> {
  const endpoint = flags.endpoint ?? "https://daymo.dev";
  const token = flags.token ?? process.env.DAYMO_ADMIN_TOKEN;
  if (!token) throw new Error("missing --token (or DAYMO_ADMIN_TOKEN env)");
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("missing GEMINI_API_KEY env");

  // 1. Discover .demo files
  const stat = await fs.stat(input);
  const demoFiles = stat.isFile()
    ? [path.resolve(input)]
    : await findDemoFiles(path.resolve(input));
  if (demoFiles.length === 0) throw new Error(`no .demo files found under ${input}`);

  console.log(`daymo publish: ${demoFiles.length} demo(s) → ${endpoint} (company=${flags.company})`);

  // 2. Build per-demo inputs by reading artifacts written by daymo render/stitch
  const demos: DemoInput[] = [];
  const mp4Paths: Array<{ relPath: string; abs: string; size: number }> = [];
  for (const demoFile of demoFiles) {
    const demoId = path.basename(demoFile, ".demo");
    const baseDir = path.dirname(demoFile);
    const dotDir = path.join(baseDir, ".daymo");
    const mp4 = path.join(baseDir, "output.mp4");
    const stepIndexFile = path.join(dotDir, "step-index.json");

    const ast = parse(await fs.readFile(demoFile, "utf8"));
    const stepIndex = JSON.parse(await fs.readFile(stepIndexFile, "utf8")) as StepIndex;
    const events: RunnerEvent[][] = await Promise.all(ast.scenes.map(async (_, i) => {
      const p = path.join(dotDir, String(i), "events.json");
      try { return JSON.parse(await fs.readFile(p, "utf8")) as RunnerEvent[]; }
      catch { return []; }
    }));

    demos.push({ demoId, demoFile, ast, events, stepIndex });
    const sz = (await fs.stat(mp4)).size;
    mp4Paths.push({ relPath: `demos/${demoId}/output.mp4`, abs: mp4, size: sz });
  }

  // 3. Build index.json in memory
  console.log(`daymo publish: building index (Gemini embeddings)…`);
  const embedder = realGeminiEmbedder(geminiKey);
  const indexJson = await buildIndex({ companyId: flags.company, demos, embedder });
  const indexBuf = Buffer.from(JSON.stringify(indexJson));
  console.log(`daymo publish: ${indexJson.chunks.length} chunks indexed`);

  // 4. Request upload tokens
  const beginBody: PublishBeginRequest = {
    companyId: flags.company,
    name: flags.name,
    brandColor: flags.brandColor,
    locale: flags.locale,
    allowedOrigins: flags.allowedOrigin,
    files: mp4Paths.map((m) => ({ relPath: m.relPath, sizeBytes: m.size, contentType: "video/mp4" })),
  };
  const beginRes = await fetch(`${endpoint}/api/admin/publish/begin`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(beginBody),
  });
  if (!beginRes.ok) throw new Error(`begin failed: ${beginRes.status} ${await beginRes.text()}`);
  const begin = (await beginRes.json()) as PublishBeginResponse;

  // 5. Upload mp4s + index.json directly to Blob using the pre-generated client tokens.
  // We use put() (not upload()) because begin already returns per-file client tokens;
  // upload() would make an extra roundtrip to handleUploadUrl to fetch a token, which
  // is unnecessary here.
  console.log(`daymo publish: uploading ${mp4Paths.length} mp4(s) + index.json to Blob…`);
  const uploadedMp4s = await Promise.all(mp4Paths.map(async (m, i) => {
    const buf = await fs.readFile(m.abs);
    await put(begin.uploads[i].targetBlobUrl, buf, {
      access: "public",
      token: begin.uploads[i].clientToken,
      contentType: "video/mp4",
    });
    return { relPath: m.relPath, sizeBytes: m.size };
  }));
  await put(begin.indexUpload.targetBlobUrl, indexBuf, {
    access: "public",
    token: begin.indexUpload.clientToken,
    contentType: "application/json",
  });

  // 6. Finalize
  const finalizeBody: PublishFinalizeRequest & { companyId: string; configPatch: any } = {
    uploadId: begin.uploadId,
    uploaded: uploadedMp4s,
    indexUploaded: { sizeBytes: indexBuf.length },
    companyId: flags.company,
    configPatch: { name: flags.name, brandColor: flags.brandColor, locale: flags.locale, allowedOrigins: flags.allowedOrigin, suggestedQuestions: deriveSuggestions(indexJson) },
  } as any;
  const finRes = await fetch(`${endpoint}/api/admin/publish/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(finalizeBody),
  });
  if (!finRes.ok) throw new Error(`finalize failed: ${finRes.status} ${await finRes.text()}`);
  const fin = (await finRes.json()) as PublishFinalizeResponse;

  const totalMb = (mp4Paths.reduce((s, m) => s + m.size, 0) / 1e6).toFixed(1);
  console.log(`✓ Published ${flags.name ?? flags.company} to ${fin.hostedUrl}`);
  console.log(`  ${demos.length} demo(s), ${indexJson.chunks.length} indexed steps, ${totalMb}MB`);
}

async function findDemoFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await findDemoFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".demo")) out.push(full);
  }
  return out;
}

function deriveSuggestions(idx: any): string[] {
  const descriptions = new Set<string>();
  for (const c of idx.chunks) {
    const line = (c.text as string).split("\n").find((l: string) => l.startsWith("[Step] "));
    if (line) {
      const d = line.replace("[Step] ", "").trim();
      if (d && d !== "(preamble)") descriptions.add(d);
    }
  }
  return Array.from(descriptions).slice(0, 3).map((d) => `How do I ${d.toLowerCase()}?`);
}
