import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rewriteLiteralAt } from "../../src/core/rewrite.js";

describe("rewriteLiteralAt", () => {
  let file: string;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rewrite-lit-"));
    file = path.join(dir, "demo.txt");
  });

  it("replaces the byte range with a JSON-encoded literal", async () => {
    const src = 'before "old text" after';
    await fs.writeFile(file, src);
    const start = src.indexOf('"old text"');
    await rewriteLiteralAt(file, { start, end: start + '"old text"'.length, line: 1 }, "new text");
    expect(await fs.readFile(file, "utf8")).toBe('before "new text" after');
  });

  it("JSON-encodes quotes and newlines safely", async () => {
    const src = 'x = "old";';
    await fs.writeFile(file, src);
    const start = src.indexOf('"old"');
    await rewriteLiteralAt(file, { start, end: start + '"old"'.length, line: 1 }, 'has "quotes"\nand newline');
    const after = await fs.readFile(file, "utf8");
    expect(after).toBe('x = "has \\"quotes\\"\\nand newline";');
  });

  it("does not perturb surrounding bytes", async () => {
    const src = '\nawait fx.say("hello world");\n// trailing comment\n';
    await fs.writeFile(file, src);
    const start = src.indexOf('"hello world"');
    await rewriteLiteralAt(file, { start, end: start + '"hello world"'.length, line: 2 }, "bye");
    expect(await fs.readFile(file, "utf8")).toBe('\nawait fx.say("bye");\n// trailing comment\n');
  });
});
