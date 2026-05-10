import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { OVERLAY_INIT_SCRIPT } from "../../src/overlay.js";

describe("controller (post-banner-removal)", () => {
  it("Controller source no longer references showCaption/hideCaption directly", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/controller.ts"), "utf8");
    expect(src).not.toMatch(/showCaption\s*\(/);
    expect(src).not.toMatch(/hideCaption\s*\(/);
  });

  it("OVERLAY_INIT_SCRIPT still defines showCaption (for fx.banner future implementation)", () => {
    expect(OVERLAY_INIT_SCRIPT).toMatch(/showCaption/);
  });
});
