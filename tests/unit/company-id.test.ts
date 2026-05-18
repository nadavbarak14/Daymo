import { describe, it, expect } from "vitest";
import { isValidCompanyId } from "../../apps/web/lib/company-id.js";

describe("isValidCompanyId", () => {
  it("accepts kebab-case slugs", () => {
    expect(isValidCompanyId("acme")).toBe(true);
    expect(isValidCompanyId("acme-corp")).toBe(true);
    expect(isValidCompanyId("a1-b2-c3")).toBe(true);
  });
  it("rejects empty, uppercase, special chars", () => {
    expect(isValidCompanyId("")).toBe(false);
    expect(isValidCompanyId("Acme")).toBe(false);
    expect(isValidCompanyId("acme_corp")).toBe(false);
    expect(isValidCompanyId("acme/corp")).toBe(false);
    expect(isValidCompanyId("a".repeat(33))).toBe(false);
  });
  it("rejects reserved Next.js routes", () => {
    expect(isValidCompanyId("api")).toBe(false);
    expect(isValidCompanyId("widget.js")).toBe(false);
    expect(isValidCompanyId("_next")).toBe(false);
    expect(isValidCompanyId("favicon.ico")).toBe(false);
    expect(isValidCompanyId("admin")).toBe(false);
  });
});
