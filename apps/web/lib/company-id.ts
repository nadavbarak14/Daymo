const PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RESERVED = new Set([
  "api", "widget.js", "_next", "favicon.ico", "robots.txt", "sitemap.xml",
  "admin", "health", "static", "public",
]);

export function isValidCompanyId(id: string): boolean {
  if (!id || id.length > 32) return false;
  if (!PATTERN.test(id)) return false;
  if (RESERVED.has(id)) return false;
  return true;
}
