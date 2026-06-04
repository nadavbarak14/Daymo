import { describe, it, expect } from "vitest";
import type {
  CoreDeps,
  CoreInput,
  CoreResult,
  HelpChatEvent,
  LoadedIndex,
} from "../../../src/chat-core/types.js";

describe("chat-core types", () => {
  it("compose a minimal CoreDeps/CoreInput", () => {
    const input: CoreInput = { message: "hi", history: [], requestId: "r1" };
    const loaded = {
      index: {} as LoadedIndex["index"],
      stepLookup: new Map(),
      videoBaseUrl: "https://x",
      suggestedQuestions: [],
      defaultLocale: "en",
    } satisfies LoadedIndex;
    const deps: CoreDeps = {
      loaded,
      embedQuery: async () => [0],
      rewriteQuery: async () => "q",
      answer: async () => ({ kind: "no_match", text: "no" }),
    };
    const ev: HelpChatEvent = {
      requestId: "r1",
      question: "hi",
      rewrittenQuery: "q",
      outcome: "no_match",
      matchedStepIds: [],
      topCosine: 0,
      latencyMs: 1,
    };
    const result: CoreResult = { status: 200, body: { kind: "no_match", text: "no" } };
    expect(input.requestId).toBe("r1");
    expect(deps.loaded.videoBaseUrl).toContain("https://");
    expect(ev.outcome).toBe("no_match");
    expect(result.status).toBe(200);
  });
});
