import { describe, it, expect, vi } from "vitest";

vi.mock("../../apps/web/lib/blob.js", () => ({
  getConfig: vi.fn(async (id: string) => id === "acme" ? {
    companyId: "acme", name: "Acme Inc", locale: "en", allowedOrigins: [],
    suggestedQuestions: ["How do I log in?"], createdAt: "",
  } : null),
}));

const { default: HelpPage } = await import("../../apps/web/app/[companyId]/help/page.js");

describe("HelpPage server component", () => {
  it("renders a header with the company name", async () => {
    const tree = await HelpPage({
      params: Promise.resolve({ companyId: "acme" }),
      searchParams: Promise.resolve({}),
    });
    const html = JSON.stringify(tree);
    expect(html).toContain("Acme Inc");
    expect(html).toContain("Product Manual");
  });

  it("calls notFound for an invalid companyId", async () => {
    let notFoundCalled = false;
    vi.doMock("next/navigation", () => ({ notFound: () => { notFoundCalled = true; throw new Error("NEXT_NOT_FOUND"); } }));
    await expect(HelpPage({
      params: Promise.resolve({ companyId: "API" }),
      searchParams: Promise.resolve({}),
    } as any)).rejects.toThrow();
  });
});
