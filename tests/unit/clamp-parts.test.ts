import { describe, it, expect } from "vitest";
import { clampParts } from "../../src/chat-server/llm.js";
import type { Part, TextPart, VideoPart } from "../../src/types.js";

const t = (s: string): TextPart => ({ kind: "text", text: s });
const v = (n: number): VideoPart => ({
  kind: "video", stepId: `d:0:${n}`, demoId: "d",
  startMs: n * 100, endMs: n * 100 + 50, caption: `c${n}`, mp4Url: "",
});

describe("clampParts", () => {
  it("keeps text parts that follow the 3rd video (the 'other demos' mention)", () => {
    const parts: Part[] = [t("a"), v(1), v(2), v(3), t("also see X and Y"), v(4)];
    const out = clampParts(parts);
    expect(out).toEqual([t("a"), v(1), v(2), v(3), t("also see X and Y")]);
  });

  it("never exceeds 6 total parts", () => {
    const parts: Part[] = [t("1"), t("2"), t("3"), t("4"), t("5"), t("6"), t("7")];
    expect(clampParts(parts)).toHaveLength(6);
  });

  it("passes through a compliant answer untouched", () => {
    const parts: Part[] = [t("a"), v(1), t("b"), v(2)];
    expect(clampParts(parts)).toEqual(parts);
  });
});
