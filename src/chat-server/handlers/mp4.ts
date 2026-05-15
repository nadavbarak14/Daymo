import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

export interface Mp4HandlerDeps {
  dataRoot: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  if (startRaw === "" && endRaw === "") return null;
  let start: number, end: number;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === "" ? size - 1 : Number(endRaw);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end >= size || start > end) return null;
  return { start, end };
}

export async function handleMp4(
  req: IncomingMessage,
  res: ServerResponse,
  widgetId: string,
  demoId: string,
  deps: Mp4HandlerDeps,
): Promise<void> {
  if (!SAFE_ID.test(widgetId) || !SAFE_ID.test(demoId)) {
    res.statusCode = 400;
    res.end();
    return;
  }
  const filePath = path.join(deps.dataRoot, "widgets", widgetId, "demos", demoId, "output.mp4");
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    res.statusCode = 404;
    res.end();
    return;
  }
  if (!stat.isFile()) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const range = parseRange(req.headers.range, stat.size);
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  if (range) {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(stat.size));
    createReadStream(filePath).pipe(res);
  }
}
