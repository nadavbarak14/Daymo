import { describe, it, expect } from "vitest";
import { validateChatResponse } from "../../src/chat-server/validate-response.js";
import type { ChatResponse, IndexedChunk } from "../../src/types.js";

const stepLookup = new Map<string, IndexedChunk>([
  ["d:0:1", { stepId: "d:0:1", demoId: "d", sceneIndex: 0, stepIndex: 1, globalStartMs: 1000, globalEndMs: 2000, text: "", embedding: [], keywords: [] }],
  ["d:0:2", { stepId: "d:0:2", demoId: "d", sceneIndex: 0, stepIndex: 2, globalStartMs: 2000, globalEndMs: 3000, text: "", embedding: [], keywords: [] }],
]);

describe("validateChatResponse", () => {
  it("passes a well-formed answer with valid stepIds and matching timestamps", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "text", text: "Here:" },
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "c", mp4Url: "x" },
    ]};
    expect(validateChatResponse(resp, stepLookup).ok).toBe(true);
  });

  it("downgrades to no_match when a stepId does not exist in the index", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "video", stepId: "d:0:99", demoId: "d", startMs: 1000, endMs: 2000, caption: "", mp4Url: "" },
    ]};
    const r = validateChatResponse(resp, stepLookup);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown stepId/i);
  });

  it("downgrades when (start,end)Ms don't match the index", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1234, endMs: 5678, caption: "", mp4Url: "" },
    ]};
    expect(validateChatResponse(resp, stepLookup).ok).toBe(false);
  });

  it("downgrades when more than 3 VideoParts are present", () => {
    const v = (n: number): import("../../src/types.js").VideoPart => ({
      kind: "video",
      stepId: `d:0:${n}`,
      demoId: "d",
      startMs: 0,
      endMs: 100,
      caption: "",
      mp4Url: "",
    });
    const resp: ChatResponse = { kind: "answer", parts: [v(1), v(2), v(1), v(2)] };
    expect(validateChatResponse(resp, stepLookup).ok).toBe(false);
  });

  it("downgrades when two consecutive parts are videos", () => {
    const resp: ChatResponse = { kind: "answer", parts: [
      { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 1000, endMs: 2000, caption: "", mp4Url: "" },
      { kind: "video", stepId: "d:0:2", demoId: "d", startMs: 2000, endMs: 3000, caption: "", mp4Url: "" },
    ]};
    expect(validateChatResponse(resp, stepLookup).ok).toBe(false);
  });

  it("downgrades when total parts > 6", () => {
    const t = (): import("../../src/types.js").TextPart => ({ kind: "text", text: "x" });
    const resp: ChatResponse = { kind: "answer", parts: [t(), t(), t(), t(), t(), t(), t()] };
    expect(validateChatResponse(resp, stepLookup).ok).toBe(false);
  });

  it("passes no_match responses unchanged", () => {
    const resp: ChatResponse = { kind: "no_match", text: "nope" };
    expect(validateChatResponse(resp, stepLookup).ok).toBe(true);
  });
});
