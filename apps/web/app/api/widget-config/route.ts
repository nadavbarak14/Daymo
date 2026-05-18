import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "../../../lib/blob.js";
import { isValidCompanyId } from "../../../lib/company-id.js";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const companyId = req.nextUrl.searchParams.get("companyId") ?? "";
  if (!isValidCompanyId(companyId)) return NextResponse.json({ error: "invalid_company_id" }, { status: 400 });
  const config = await getConfig(companyId);
  if (!config) return NextResponse.json({ error: "unknown_company" }, { status: 404 });
  return NextResponse.json({
    name: config.name,
    brandColor: config.brandColor,
    locale: config.locale,
    suggestedQuestions: config.suggestedQuestions,
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    },
  });
}
