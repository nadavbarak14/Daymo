import { describe, it, expect } from "vitest";
import { resolveLocale, getStrings } from "../../widget/src/locale.js";

describe("resolveLocale", () => {
  it("returns the explicit override when provided", () => {
    expect(resolveLocale({ override: "es", htmlLang: "fr", navigatorLang: "de-DE" })).toBe("es");
  });
  it("uses <html lang> when no override is provided", () => {
    expect(resolveLocale({ override: undefined, htmlLang: "ja", navigatorLang: "en-US" })).toBe("ja");
  });
  it("falls back to navigator language when html lang is missing", () => {
    expect(resolveLocale({ override: undefined, htmlLang: "", navigatorLang: "pt-BR" })).toBe("pt");
  });
  it("falls back to 'en' for unknown locales", () => {
    expect(resolveLocale({ override: "klingon", htmlLang: "", navigatorLang: "" })).toBe("en");
  });
  it("maps zh-Hant or zh-TW down to 'en' (only zh-CN ships)", () => {
    expect(resolveLocale({ override: "zh-Hant", htmlLang: "", navigatorLang: "" })).toBe("en");
    expect(resolveLocale({ override: "zh-CN", htmlLang: "", navigatorLang: "" })).toBe("zh-CN");
  });
});

describe("getStrings", () => {
  it("returns the full string bundle for a locale", () => {
    const s = getStrings("en");
    expect(s.greeting).toBeTruthy();
    expect(s.inputPlaceholder).toBeTruthy();
    expect(s.rateLimitMessage).toBeTruthy();
    expect(s.noMatchPrefix).toBeTruthy();
  });
  it("returns en strings for an unknown locale", () => {
    const s = getStrings("klingon" as never);
    expect(s).toBe(getStrings("en"));
  });
});
