import { describe, it, expect } from "vitest";
import { buildGalleryModel, formatDuration } from "../../../src/help-center/gallery-model.js";
import type { HelpManifest } from "../../../src/publish/types.js";

describe("formatDuration", () => {
  it("formats ms as m:ss", () => {
    expect(formatDuration(9000)).toBe("0:09");
    expect(formatDuration(90000)).toBe("1:30");
  });
});

describe("buildGalleryModel", () => {
  it("maps manifest demos into gallery cards", () => {
    const manifest: HelpManifest = {
      version: "v1",
      videoBaseUrl: "https://cdn/help/v1",
      demos: [
        {
          demoId: "d",
          title: "Create a note",
          description: "How to create",
          durationMs: 90000,
          videoUrl: "https://cdn/help/v1/d/output.mp4",
          posterUrl: "https://cdn/help/v1/d/poster.jpg",
          steps: [
            { stepId: "d:0:1", label: "click", startMs: 0 },
            { stepId: "d:0:2", label: "name", startMs: 5000 },
          ],
        },
      ],
    };
    const model = buildGalleryModel(manifest);
    expect(model.cards).toHaveLength(1);
    expect(model.cards[0].durationLabel).toBe("1:30");
    expect(model.cards[0].stepCount).toBe(2);
    expect(model.cards[0].videoUrl).toContain("/d/output.mp4");
  });
});
