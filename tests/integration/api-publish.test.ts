import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob/x" }),
  head: vi.fn().mockResolvedValue({ size: 100 }),
  list: vi.fn().mockResolvedValue({ blobs: [] }),
}));
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: vi.fn().mockResolvedValue("token-x"),
}));
vi.mock("../../apps/web/lib/blob.js", () => ({
  invalidate: vi.fn(), putConfig: vi.fn(), getConfig: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => { process.env.DAYMO_ADMIN_TOKEN = "test-token"; process.env.BLOB_READ_WRITE_TOKEN = "blob-token"; });

const { POST: beginPost } = await import("../../apps/web/app/api/admin/publish/begin/route.js");
const { POST: finalizePost } = await import("../../apps/web/app/api/admin/publish/finalize/route.js");

function req(body: any, headers: Record<string, string> = {}): any {
  return {
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    nextUrl: new URL("https://x/api/admin/publish/x"),
  };
}

describe("POST /api/admin/publish/begin", () => {
  it("rejects without token", async () => {
    const res = await beginPost(req({ companyId: "acme", files: [] }) as any);
    expect(res.status).toBe(401);
  });
  it("returns upload tokens with valid token", async () => {
    const res = await beginPost(req(
      { companyId: "acme", files: [{ relPath: "demos/t/output.mp4", sizeBytes: 1, contentType: "video/mp4" }] },
      { authorization: "Bearer test-token" }
    ) as any);
    const data = await res.json();
    expect(data.uploadId).toBeDefined();
    expect(data.uploads.length).toBe(1);
    expect(data.indexUpload.clientToken).toBe("token-x");
  });
});

describe("POST /api/admin/publish/finalize", () => {
  it("writes config and returns hostedUrl", async () => {
    process.env.DAYMO_HOSTED_ORIGIN = "https://daymo.dev";
    const res = await finalizePost(req(
      { companyId: "acme", uploadId: "u1", uploaded: [{ relPath: "demos/t/output.mp4", sizeBytes: 1 }], indexUploaded: { sizeBytes: 1 }, configPatch: { name: "Acme" } },
      { authorization: "Bearer test-token" }
    ) as any);
    const data = await res.json();
    expect(data.hostedUrl).toBe("https://daymo.dev/acme/help");
  });
});
