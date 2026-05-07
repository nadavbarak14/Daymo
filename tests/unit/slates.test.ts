// tests/unit/slates.test.ts
import { describe, it, expect } from "vitest";
import { buildSlateHtml, resolveIntroConfig, resolveOutroConfig } from "../../src/slates.js";

describe("resolveIntroConfig", () => {
  it("defaults to title + description from frontmatter", () => {
    const cfg = resolveIntroConfig(
      { title: "T", description: "D" } as any,
      undefined,
    );
    expect(cfg).toMatchObject({
      kind: "intro",
      durationMs: 2500,
      background: "#0a0a0a",
      accent: "#3b82f6",
      title: "T",
      subtitle: "D",
    });
  });

  it("intro: false returns null (disabled)", () => {
    expect(resolveIntroConfig({ title: "T" } as any, false)).toBeNull();
  });

  it("intro override merges with defaults; title/subtitle still resolve from frontmatter when omitted", () => {
    const cfg = resolveIntroConfig(
      { title: "T", description: "D" } as any,
      { durationMs: 3000, background: "#000", accent: "#fff" },
    );
    expect(cfg).toMatchObject({
      kind: "intro",
      durationMs: 3000,
      background: "#000",
      accent: "#fff",
      title: "T",
      subtitle: "D",
    });
  });

  it("intro override with explicit title wins over frontmatter title", () => {
    const cfg = resolveIntroConfig(
      { title: "FromFM" } as any,
      { durationMs: 2500, background: "#000", accent: "#fff", title: "Custom" },
    );
    expect(cfg!.title).toBe("Custom");
  });
});

describe("resolveOutroConfig", () => {
  it("defaults to title from frontmatter and 'Made with Daymo' footer", () => {
    const cfg = resolveOutroConfig({ title: "T" } as any, undefined);
    expect(cfg).toMatchObject({
      kind: "outro",
      durationMs: 2000,
      title: "T",
      text: "Made with Daymo",
    });
  });

  it("outro: false returns null", () => {
    expect(resolveOutroConfig({ title: "T" } as any, false)).toBeNull();
  });

  it("outro override text wins over default", () => {
    const cfg = resolveOutroConfig(
      { title: "T" } as any,
      { durationMs: 2000, background: "#0a0a0a", accent: "#3b82f6", text: "thanks!" },
    );
    expect(cfg!.text).toBe("thanks!");
  });
});

describe("buildSlateHtml", () => {
  it("includes title and subtitle in the html", () => {
    const html = buildSlateHtml({
      kind: "intro",
      durationMs: 2500, background: "#000", accent: "#fff",
      title: "Hello", subtitle: "World",
    });
    expect(html).toContain("Hello");
    expect(html).toContain("World");
    expect(html).toContain("background:#000");
    expect(html).toContain("#fff");
  });

  it("includes outro footer text when provided", () => {
    const html = buildSlateHtml({
      kind: "outro",
      durationMs: 2000, background: "#000", accent: "#fff",
      title: "Thanks", text: "footer text",
    });
    expect(html).toContain("Thanks");
    expect(html).toContain("footer text");
  });

  it("escapes html-unsafe characters in title", () => {
    const html = buildSlateHtml({
      kind: "intro",
      durationMs: 2500, background: "#000", accent: "#fff",
      title: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a logo when provided", () => {
    const html = buildSlateHtml({
      kind: "intro",
      durationMs: 2500, background: "#000", accent: "#fff",
      title: "x", logo: "/abs/path/logo.svg",
    });
    expect(html).toContain("file:///abs/path/logo.svg");
  });
});
