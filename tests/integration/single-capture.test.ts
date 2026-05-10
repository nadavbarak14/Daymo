import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { startSampleApp, stopSampleApp } from "./server.js";
import { parse } from "../../src/parser.js";
import { captureSingleScene } from "../../src/single-capture.js";

let appUrl: string;
beforeAll(async () => { appUrl = await startSampleApp(); }, 30_000);
afterAll(async () => { await stopSampleApp(); });

describe("captureSingleScene", () => {
  it("produces a webm + events for one scene", async () => {
    const demoFile = path.resolve("tests/fixtures/demos/smoke.demo");
    const ast = parse(await fs.readFile(demoFile, "utf8"));
    const ast2 = { ...ast, frontmatter: { ...ast.frontmatter, url: appUrl } };

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-cap-"));
    const out = await captureSingleScene(ast2, 0, {
      capturesDir: tmp,
      demoFile,
    });

    expect(out.webm).toMatch(/scene-001\.webm$/);
    const stat = await fs.stat(out.webm);
    expect(stat.size).toBeGreaterThan(0);

    const events = JSON.parse(await fs.readFile(out.events, "utf8"));
    expect(events.find((e: any) => e.kind === "scene_start")).toBeTruthy();
    expect(events.find((e: any) => e.kind === "scene_end")).toBeTruthy();
  }, 30_000);
});
