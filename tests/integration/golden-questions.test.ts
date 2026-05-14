import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeIndexForDemoDir } from "../../src/indexer/write-index.js";
import { embedQuery } from "../../src/indexer/embedder-gemini.js";
import { retrieve } from "../../src/chat-server/retrieve.js";
import { extractKeywords } from "../../src/indexer/keywords.js";
import type { IndexFile } from "../../src/types.js";

const run = process.env.RUN_EMBED_TESTS === "1" && process.env.GEMINI_API_KEY;

describe.skipIf(!run)("golden-questions recall (real Gemini)", () => {
  it("achieves recall@3 >= 85% on the loomly fixture", async () => {
    const fixtureDir = path.resolve("tests/fixtures/demo-chat/loomly");
    const goldenRaw = await fs.readFile(path.join(fixtureDir, "golden-questions.json"), "utf8");
    const golden = JSON.parse(goldenRaw) as Array<{ q: string; expectedStepId?: string; expected?: "no_match" }>;

    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-golden-"));
    await writeIndexForDemoDir({
      demoDir: fixtureDir,
      widgetId: "fixture",
      widgetName: "Fixture",
      locale: "en",
      allowedOrigins: ["https://example.com"],
      dataRoot,
      geminiApiKey: process.env.GEMINI_API_KEY!,
    });

    const indexFile = JSON.parse(
      await fs.readFile(path.join(dataRoot, "widgets/fixture/index.json"), "utf8"),
    ) as IndexFile;

    let hits = 0;
    let totalMatchable = 0;
    for (const g of golden) {
      if (g.expected === "no_match") continue;
      totalMatchable += 1;
      const qe = await embedQuery(g.q, { apiKey: process.env.GEMINI_API_KEY! });
      const r = retrieve({
        query: { embedding: qe, keywords: extractKeywords(g.q) },
        chunks: indexFile.chunks,
        k: 3,
      });
      if (r.chunks.some((c) => c.stepId === g.expectedStepId)) hits += 1;
    }
    const recall = hits / Math.max(1, totalMatchable);
    expect(recall).toBeGreaterThanOrEqual(0.85);
  }, 120_000);
});
