import { describe, it, expect } from "vitest";
import { buildMp4Url } from "../../src/chat-server/mp4-url.js";

describe("buildMp4Url", () => {
  it("constructs the canonical URL from baseUrl + widgetId + demoId", () => {
    expect(buildMp4Url({
      baseUrl: "https://daymo.dev",
      widgetId: "wgt_a",
      demoId: "loomly-tour",
    })).toBe("https://daymo.dev/widgets/wgt_a/demos/loomly-tour/output.mp4");
  });

  it("strips trailing slash from baseUrl", () => {
    expect(buildMp4Url({
      baseUrl: "https://daymo.dev/",
      widgetId: "wgt_a",
      demoId: "x",
    })).toBe("https://daymo.dev/widgets/wgt_a/demos/x/output.mp4");
  });

  it("rejects path-traversal in widgetId or demoId", () => {
    expect(() => buildMp4Url({ baseUrl: "https://x", widgetId: "..", demoId: "y" })).toThrow();
    expect(() => buildMp4Url({ baseUrl: "https://x", widgetId: "a", demoId: "../etc/passwd" })).toThrow();
    expect(() => buildMp4Url({ baseUrl: "https://x", widgetId: "a/b", demoId: "c" })).toThrow();
  });
});
