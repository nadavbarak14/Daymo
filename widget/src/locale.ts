import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import ja from "./locales/ja.json";
import pt from "./locales/pt.json";
import zhCN from "./locales/zh-CN.json";
import it from "./locales/it.json";

export type SupportedLocale = "en" | "es" | "fr" | "de" | "ja" | "pt" | "zh-CN" | "it";

export interface StringBundle {
  greeting: string;
  inputPlaceholder: string;
  send: string;
  open: string;
  close: string;
  back: string;
  suggestedHeader: string;
  rateLimitMessage: string;
  upstreamErrorMessage: string;
  noMatchPrefix: string;
  notConfiguredMessage: string;
  caption: string;
}

const BUNDLES: Record<SupportedLocale, StringBundle> = {
  en: en as StringBundle,
  es: es as StringBundle,
  fr: fr as StringBundle,
  de: de as StringBundle,
  ja: ja as StringBundle,
  pt: pt as StringBundle,
  "zh-CN": zhCN as StringBundle,
  it: it as StringBundle,
};

export function getStrings(locale: string): StringBundle {
  if (locale in BUNDLES) return BUNDLES[locale as SupportedLocale];
  return BUNDLES.en;
}

export interface ResolveLocaleInput {
  override: string | undefined;
  htmlLang: string;
  navigatorLang: string;
}

export function resolveLocale(input: ResolveLocaleInput): SupportedLocale {
  const candidates = [input.override, input.htmlLang, input.navigatorLang].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c in BUNDLES) return c as SupportedLocale;
    const short = c.split("-")[0];
    if (short in BUNDLES) return short as SupportedLocale;
  }
  return "en";
}
