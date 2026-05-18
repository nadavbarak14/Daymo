import { NextRequest, NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { randomUUID } from "node:crypto";
import { isValidCompanyId } from "../../../../../lib/company-id.js";
import type { PublishBeginRequest, PublishBeginResponse } from "../../../../../../../src/core/publish-contract.js";

export const runtime = "nodejs";

function checkAuth(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.DAYMO_ADMIN_TOKEN}`;
  return auth === expected;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: PublishBeginRequest;
  try { body = (await req.json()) as PublishBeginRequest; }
  catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  if (!isValidCompanyId(body.companyId)) return NextResponse.json({ error: "invalid_company_id" }, { status: 400 });

  const uploadId = randomUUID();
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN!;

  async function tokenFor(relPath: string): Promise<string> {
    return await generateClientTokenFromReadWriteToken({
      token: blobToken,
      pathname: `companies/${body.companyId}/${relPath}`,
      validUntil: Date.now() + 60 * 60 * 1000,
    });
  }

  const uploads = await Promise.all(body.files.map(async (f) => ({
    relPath: f.relPath,
    clientToken: await tokenFor(f.relPath),
    targetBlobUrl: `companies/${body.companyId}/${f.relPath}`,
  })));

  const response: PublishBeginResponse = {
    uploadId,
    uploads,
    indexUpload: {
      clientToken: await tokenFor("index.json"),
      targetBlobUrl: `companies/${body.companyId}/index.json`,
    },
  };
  return NextResponse.json(response);
}
