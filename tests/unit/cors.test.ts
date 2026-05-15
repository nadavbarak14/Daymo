import { describe, it, expect } from "vitest";
import { checkOrigin, corsHeaders } from "../../src/chat-server/cors.js";

describe("checkOrigin", () => {
  it("returns true for an exact match against the allowlist", () => {
    expect(checkOrigin("https://example.com", ["https://example.com"])).toBe(true);
  });
  it("is case-sensitive on the host (HTTPS does NOT match https)", () => {
    expect(checkOrigin("HTTPS://example.com", ["https://example.com"])).toBe(false);
  });
  it("rejects unknown origins", () => {
    expect(checkOrigin("https://evil.com", ["https://example.com"])).toBe(false);
  });
  it("rejects empty / missing origin header", () => {
    expect(checkOrigin(undefined, ["https://example.com"])).toBe(false);
    expect(checkOrigin("", ["https://example.com"])).toBe(false);
  });
  it("rejects '*' wildcard regardless of allowlist content", () => {
    expect(checkOrigin("https://example.com", ["*"])).toBe(false);
  });
});

describe("corsHeaders", () => {
  it("emits the request's origin (not '*') so credentials are allowed", () => {
    const h = corsHeaders("https://example.com");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://example.com");
    expect(h["Vary"]).toBe("Origin");
  });
  it("sets allowed methods and content-type for the preflight", () => {
    const h = corsHeaders("https://example.com");
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
    expect(h["Access-Control-Allow-Methods"]).toContain("GET");
    expect(h["Access-Control-Allow-Headers"]).toContain("Content-Type");
  });
});
