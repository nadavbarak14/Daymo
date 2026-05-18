import { NextRequest, NextResponse } from "next/server";
import type { PublishHealthResponse } from "../../../../../../../src/core/publish-contract.js";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.DAYMO_ADMIN_TOKEN}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const response: PublishHealthResponse = { ok: true, endpoint: req.nextUrl.origin };
  return NextResponse.json(response);
}
