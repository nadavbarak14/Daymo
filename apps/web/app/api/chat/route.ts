import { NextRequest, NextResponse } from "next/server";
import type { ChatRequest } from "../../../../../src/core/index-types.js";
import { getConfig, getIndex, mp4Url } from "../../../lib/blob.js";
import { realGeminiClient } from "../../../lib/gemini.js";
import { runChatPipeline } from "../../../lib/chat-pipeline.js";
import { checkRateLimit } from "../../../lib/rate-limit.js";
import { isValidCompanyId } from "../../../lib/company-id.js";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ChatRequest;
  try { body = (await req.json()) as ChatRequest; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  if (!isValidCompanyId(body.companyId)) {
    return NextResponse.json({ error: "invalid_company_id" }, { status: 400 });
  }

  const config = await getConfig(body.companyId);
  if (!config) return NextResponse.json({ error: "unknown_company" }, { status: 404 });

  const origin = req.headers.get("origin") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("host");
  const isHostedManual =
    (host ? `${proto}://${host}` === origin : false) ||
    origin === process.env.DAYMO_HOSTED_ORIGIN;
  if (!isHostedManual && !config.allowedOrigins.includes(origin)) {
    return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit(`chat:${body.companyId}:${ip}`, 30, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  const index = await getIndex(body.companyId);
  if (!index) return NextResponse.json({ error: "index_unavailable" }, { status: 502 });

  try {
    const gemini = realGeminiClient(process.env.GEMINI_API_KEY!);
    const response = await runChatPipeline({
      request: body, index, gemini,
      mp4UrlFor: (demoId) => mp4Url(body.companyId, demoId),
    });
    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": origin,
      "Vary": "Origin",
    };
    return NextResponse.json(response, { headers });
  } catch (e) {
    console.error("chat error", e);
    return NextResponse.json({ error: "upstream_error" }, { status: 502 });
  }
}

export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin") ?? "";
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  });
}
