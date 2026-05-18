import { describe, it, expect } from "vitest";
import { execaCommand } from "execa";
import fs from "node:fs/promises";
import path from "node:path";

const RUN = process.env.RUN_E2E_CHAT === "1";
const describeIf = RUN ? describe : describe.skip;

describeIf("E2E: render → stitch → publish → /api/chat", () => {
  const fixtureDir = path.join(__dirname, "../fixtures/demo-chat/loomly-tour");
  const demoFile = path.join(fixtureDir, "tour.demo");

  it("answers golden questions with expected stepId or no_match", async () => {
    await execaCommand(`node ./dist/cli.js render ${demoFile}`);
    await execaCommand(`node ./dist/cli.js stitch ${demoFile}`);

    const endpoint = process.env.E2E_ENDPOINT ?? "http://localhost:3000";
    await execaCommand(`node ./dist/cli.js publish ${demoFile} --company e2e-test --name "E2E" --endpoint ${endpoint}`, {
      env: { ...process.env, DAYMO_ADMIN_TOKEN: process.env.DAYMO_ADMIN_TOKEN!, GEMINI_API_KEY: process.env.GEMINI_API_KEY! },
    });

    const golden = JSON.parse(await fs.readFile(path.join(fixtureDir, "golden-questions.json"), "utf8")) as Array<any>;
    for (const item of golden) {
      const res = await fetch(`${endpoint}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: "e2e-test", message: item.q, history: [] }),
      });
      const data = await res.json();
      if (item.expected === "no_match") {
        expect(data.kind).toBe("no_match");
      } else {
        expect(data.kind).toBe("answer");
        const videoParts = data.parts.filter((p: any) => p.kind === "video");
        expect(videoParts.length).toBeGreaterThan(0);
        expect(videoParts.some((p: any) => p.stepId.startsWith(item.expectedStepIdPrefix))).toBe(true);
      }
    }
  }, 300_000);
});
