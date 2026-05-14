import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { rewriteQuery } from "../../src/chat-server/rewrite-query.js";

const run = process.env.RUN_LLM_TESTS === "1" && process.env.ANTHROPIC_API_KEY;

describe.skipIf(!run)("rewriteQuery (real Haiku)", () => {
  it("rewrites 'and then?' using prior context", async () => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const out = await rewriteQuery({
      message: "and then?",
      history: [
        { role: "user", content: "how do I create a project?" },
        { role: "assistant", content: "Click + New project, fill in the name and description, hit Create." },
      ],
      client,
    });
    expect(out.toLowerCase()).toMatch(/(after|next|then|continue|project)/);
  }, 30_000);
});
