// src/slates.ts
import type { Frontmatter, SlateConfig, SlateInput } from "./types.js";

export interface ResolvedSlate extends SlateConfig {
  kind: "intro" | "outro";
}

const DEFAULT_BG = "#0a0a0a";
const DEFAULT_ACCENT = "#3b82f6";

export function resolveIntroConfig(fm: Frontmatter, raw: SlateInput): ResolvedSlate | null {
  if (raw === false) return null;
  const base: SlateConfig = {
    durationMs: 2500,
    background: DEFAULT_BG,
    accent: DEFAULT_ACCENT,
    title: fm.title,
    subtitle: fm.description,
  };
  if (raw === undefined) return { kind: "intro", ...base };
  return {
    kind: "intro",
    ...base,
    ...raw,
    title: raw.title ?? fm.title,
    subtitle: raw.subtitle ?? fm.description,
  };
}

export function resolveOutroConfig(fm: Frontmatter, raw: SlateInput): ResolvedSlate | null {
  if (raw === false) return null;
  const base: SlateConfig = {
    durationMs: 2000,
    background: DEFAULT_BG,
    accent: DEFAULT_ACCENT,
    title: fm.title,
    text: "Made with Daymo",
  };
  if (raw === undefined) return { kind: "outro", ...base };
  return {
    kind: "outro",
    ...base,
    ...raw,
    title: raw.title ?? fm.title,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}

export function buildSlateHtml(s: ResolvedSlate): string {
  const logoTag = s.logo
    ? `<img src="file://${s.logo}" style="max-width:200px;max-height:60px;margin-bottom:32px"/>`
    : "";
  const subtitleTag = s.subtitle
    ? `<div style="font-size:28px;color:#cbd5e1;margin-top:16px">${escapeHtml(s.subtitle)}</div>`
    : "";
  const footerTag = s.text
    ? `<div style="position:absolute;bottom:48px;font-size:18px;color:#94a3b8">${escapeHtml(s.text)}</div>`
    : "";
  return `<!doctype html><html><head><style>
    html,body{margin:0;height:100%;background:${s.background};font-family:Inter,system-ui,sans-serif;color:#fff;}
    .root{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;position:relative;}
    .accent{width:64px;height:4px;background:${s.accent};margin-bottom:32px;border-radius:2px;}
    h1{font-size:64px;margin:0;font-weight:700;letter-spacing:-0.02em;}
  </style></head><body><div class="root">
    ${logoTag}
    <div class="accent"></div>
    <h1>${escapeHtml(s.title ?? "")}</h1>
    ${subtitleTag}
    ${footerTag}
  </div></body></html>`;
}
