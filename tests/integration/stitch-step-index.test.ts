import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { stitchCommand } from "../../src/commands/stitch.js";

describe("stitchCommand writes step-index.json (integration with real ffmpeg)", () => {
  it("produces .daymo/step-index.json with one scene entry per scene and matching global timestamps", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-stitch-"));

    const daymoDir = path.join(tmp, ".daymo");
    const capDir = path.join(daymoDir, "captures");
    await fs.mkdir(path.join(capDir, "scene-001"), { recursive: true });
    await fs.mkdir(path.join(capDir, "scene-002"), { recursive: true });
    await fs.mkdir(path.join(daymoDir, "tts"), { recursive: true });

    for (const seg of ["scene-001", "scene-002"]) {
      await execa("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", "color=size=320x240:rate=24:color=black",
        "-t", "3",
        "-c:v", "libvpx", "-b:v", "200k",
        path.join(capDir, seg, "video.webm"),
      ]);
    }

    await fs.writeFile(path.join(capDir, "scene-001", "events.json"), JSON.stringify([
      { kind: "scene_start", t: 0, index: 0, title: "First", prose: "", recordingOffsetMs: 0 },
      { kind: "step", t: 1000, sceneIndex: 0, stepIndex: 1, description: "First step" },
      { kind: "scene_end", t: 3000, index: 0 },
    ]));
    await fs.writeFile(path.join(capDir, "scene-002", "events.json"), JSON.stringify([
      { kind: "scene_start", t: 0, index: 1, title: "Second", prose: "", recordingOffsetMs: 0 },
      { kind: "step", t: 500, sceneIndex: 1, stepIndex: 1, description: "Second step" },
      { kind: "scene_end", t: 3000, index: 1 },
    ]));

    await fs.writeFile(path.join(daymoDir, "state.json"), JSON.stringify({
      version: 2,
      scenes: [
        { sourceLine: 6, state: "captured", webmPath: path.join(capDir, "scene-001", "video.webm"), eventsPath: path.join(capDir, "scene-001", "events.json") },
        { sourceLine: 14, state: "captured", webmPath: path.join(capDir, "scene-002", "video.webm"), eventsPath: path.join(capDir, "scene-002", "events.json") },
      ],
    }));

    const demoFile = path.join(tmp, "fixture.demo");
    await fs.writeFile(demoFile, `---\ntitle: Fixture\nurl: http://localhost\n---\n\n# First\n\n\`\`\`playwright\nawait fx.step("First step");\n\`\`\`\n\n---\n\n# Second\n\n\`\`\`playwright\nawait fx.step("Second step");\n\`\`\`\n`);

    await stitchCommand(demoFile);

    const stepIndexRaw = await fs.readFile(path.join(daymoDir, "step-index.json"), "utf8");
    const idx = JSON.parse(stepIndexRaw);

    expect(idx.demoId).toBe("fixture");
    expect(idx.scenes).toHaveLength(2);
    expect(idx.scenes[0].globalStartMs).toBe(0);
    expect(idx.scenes[1].globalStartMs).toBeGreaterThanOrEqual(2800);
    expect(idx.scenes[1].globalStartMs).toBeLessThanOrEqual(3200);
    expect(idx.steps).toHaveLength(4);
    expect(idx.steps.map((s: { stepId: string }) => s.stepId)).toEqual([
      "fixture:0:0", "fixture:0:1", "fixture:1:0", "fixture:1:1",
    ]);
  }, 90_000);
});
