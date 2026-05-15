import { describe, it, expect } from "vitest";
import { createChatState } from "../../widget/src/chat-state.js";

describe("createChatState", () => {
  it("starts in 'closed' state with empty history", () => {
    const s = createChatState();
    expect(s.getState().phase).toBe("closed");
    expect(s.getState().history).toEqual([]);
  });

  it("open() transitions to 'open' (idle)", () => {
    const s = createChatState();
    s.open();
    expect(s.getState().phase).toBe("open-idle");
  });

  it("submitMessage('hi') appends a user turn and goes to awaiting", () => {
    const s = createChatState();
    s.open();
    s.submitMessage("hi");
    expect(s.getState().phase).toBe("awaiting");
    expect(s.getState().history).toEqual([{ role: "user", content: "hi" }]);
  });

  it("receiveAnswer appends an assistant turn (summarized from parts) and returns to idle", () => {
    const s = createChatState();
    s.open();
    s.submitMessage("hi");
    s.receiveAnswer({
      kind: "answer",
      parts: [
        { kind: "text", text: "Here's how:" },
        { kind: "video", stepId: "d:0:1", demoId: "d", startMs: 0, endMs: 100, caption: "c", mp4Url: "u" },
      ],
    });
    expect(s.getState().phase).toBe("open-idle");
    expect(s.getState().history.at(-1)).toEqual({ role: "assistant", content: "Here's how:" });
  });

  it("caps history to the last 2 turns (4 messages: 2 user + 2 assistant)", () => {
    const s = createChatState();
    s.open();
    for (let i = 0; i < 3; i++) {
      s.submitMessage(`q${i}`);
      s.receiveAnswer({ kind: "no_match", text: `a${i}` });
    }
    expect(s.getState().history).toHaveLength(4);
    expect(s.getState().history[0]).toEqual({ role: "user", content: "q1" });
    expect(s.getState().history[3]).toEqual({ role: "assistant", content: "a2" });
  });

  it("receiveError transitions to 'error' with a message; clearError returns to idle", () => {
    const s = createChatState();
    s.open();
    s.submitMessage("hi");
    s.receiveError("ratelimit");
    expect(s.getState().phase).toBe("error");
    expect(s.getState().errorKind).toBe("ratelimit");
    s.clearError();
    expect(s.getState().phase).toBe("open-idle");
  });

  it("close() returns to 'closed' without dropping history (resume next open)", () => {
    const s = createChatState();
    s.open();
    s.submitMessage("hi");
    s.receiveAnswer({ kind: "no_match", text: "x" });
    s.close();
    expect(s.getState().phase).toBe("closed");
    expect(s.getState().history).toHaveLength(2);
  });

  it("subscribe fires on every state change", () => {
    const s = createChatState();
    const calls: string[] = [];
    s.subscribe(() => calls.push(s.getState().phase));
    s.open();
    s.submitMessage("hi");
    expect(calls.length).toBe(2);
  });
});
