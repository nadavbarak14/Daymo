import { describe, it, expect } from "vitest";
import { groupVideoParts } from "../../../src/help-center/answer-cards.js";
import type { Part } from "../../../src/types.js";

const v = (demoId: string, n: number, startMs: number, endMs: number): Part => ({
  kind: "video", stepId: `${demoId}:0:${n}`, demoId, startMs, endMs, caption: `cap${n}`, mp4Url: `/v/${demoId}.mp4`,
});

describe("groupVideoParts", () => {
  it("collapses same-demo parts into one card at the first part's index, cued at the earliest step", () => {
    const parts: Part[] = [
      { kind: "text", text: "intro" },
      v("d", 2, 2500, 3200),
      { kind: "text", text: "then" },
      v("d", 1, 1000, 1900),
      v("e", 1, 0, 700),
    ];
    const cards = groupVideoParts(parts);
    expect([...cards.keys()]).toEqual([1, 4]);          // card renders where the demo first appears
    const d = cards.get(1)!;
    expect(d.demoId).toBe("d");
    expect(d.startMs).toBe(1000);                        // earliest referenced step wins the cue
    expect(d.endMs).toBe(3200);                          // end of the referenced range
    expect(d.steps.map((s) => s.stepId)).toEqual(["d:0:2", "d:0:1"]);
    expect(cards.get(4)!.demoId).toBe("e");
  });

  it("returns one entry per demo for the single-part case", () => {
    const cards = groupVideoParts([v("d", 1, 100, 900)]);
    expect(cards.size).toBe(1);
    expect(cards.get(0)!.steps).toHaveLength(1);
  });
});
