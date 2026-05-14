const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export interface BuildMp4UrlOpts {
  baseUrl: string;
  widgetId: string;
  demoId: string;
}

export function buildMp4Url(opts: BuildMp4UrlOpts): string {
  if (!SAFE_ID.test(opts.widgetId)) throw new Error(`unsafe widgetId: ${opts.widgetId}`);
  if (!SAFE_ID.test(opts.demoId)) throw new Error(`unsafe demoId: ${opts.demoId}`);
  const base = opts.baseUrl.replace(/\/+$/, "");
  return `${base}/widgets/${opts.widgetId}/demos/${opts.demoId}/output.mp4`;
}
