import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parse } from "../../src/parser.js";
import { emitManual } from "../../src/core/manual.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SHIPPED_DEMOS = [
  "demo-tour.demo",
  "wikipedia-tour.demo",
  "hacker-news-tour.demo",
  "screenassist-app-tour.demo",
  "screenassist-tour.demo",
];

describe("manual golden snapshots", () => {
  for (const filename of SHIPPED_DEMOS) {
    it(`matches the golden for ${filename}`, () => {
      const src = fs.readFileSync(path.join(REPO_ROOT, filename), "utf8");
      const fixtureName = filename.replace(/\.demo$/, ".manual.md");
      const fixturePath = path.join(REPO_ROOT, "tests", "fixtures", "manual", fixtureName);
      const actual = emitManual(parse(src)).markdown;
      const expected = fs.readFileSync(fixturePath, "utf8");
      expect(actual).toBe(expected);
    });
  }
});
