import { NextRequest, NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { invalidate, putConfig, getConfig } from "../../../../../lib/blob.js";
import type { PublishFinalizeRequest, PublishFinalizeResponse } from "../../../../../../../src/core/publish-contract.js";
import type { CompanyConfig } from "../../../../../../../src/core/index-types.js";

export const runtime = "nodejs";

function checkAuth(req: NextRequest): boolean {
  return req.headers.get("authorization") === `Bearer ${process.env.DAYMO_ADMIN_TOKEN}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: PublishFinalizeRequest & { companyId: string; configPatch?: Partial<CompanyConfig> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  // Verify each file landed in Blob with matching size.
  for (const u of body.uploaded) {
    try {
      await head(`companies/${body.companyId}/${u.relPath}`);
    } catch {
      return NextResponse.json({ error: "missing_uploaded_file", relPath: u.relPath }, { status: 400 });
    }
  }
  try { await head(`companies/${body.companyId}/index.json`); }
  catch { return NextResponse.json({ error: "missing_index_json" }, { status: 400 }); }

  // Merge config: existing + patch + defaults.
  const existing = await getConfig(body.companyId);
  const merged: CompanyConfig = {
    companyId: body.companyId,
    name: body.configPatch?.name ?? existing?.name ?? body.companyId,
    brandColor: body.configPatch?.brandColor ?? existing?.brandColor,
    locale: body.configPatch?.locale ?? existing?.locale ?? "en",
    allowedOrigins: body.configPatch?.allowedOrigins ?? existing?.allowedOrigins ?? [],
    suggestedQuestions: body.configPatch?.suggestedQuestions ?? existing?.suggestedQuestions ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await putConfig(body.companyId, merged);
  invalidate(body.companyId);

  const response: PublishFinalizeResponse = {
    hostedUrl: `${process.env.DAYMO_HOSTED_ORIGIN ?? "https://daymo.dev"}/${body.companyId}/help`,
    uploadedAt: new Date().toISOString(),
  };
  return NextResponse.json(response);
}
