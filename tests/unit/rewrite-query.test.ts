import { describe, it, expect, vi } from "vitest";
import { rewriteQuery } from "../../src/chat-server/rewrite-query.js";

describe("rewriteQuery", () => {
  it("returns the user message verbatim when history is empty", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "How do I create a project?" }],
        }),
      },
    };
    const out = await rewriteQuery({
      message: "How do I create a project?",
      history: [],
      client: mockClient as never,
    });
    expect(out).toBe("How do I create a project?");
  });

  it("incorporates conversation history into the rewritten query", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "what comes after creating a project?" }],
        }),
      },
    };
    const out = await rewriteQuery({
      message: "and then?",
      history: [
        { role: "user", content: "how do I create a project?" },
        { role: "assistant", content: "Click + New project." },
      ],
      client: mockClient as never,
    });
    expect(out).toBe("what comes after creating a project?");
    expect(mockClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5-20251001" }),
    );
  });

  it("trims surrounding whitespace and quotes from the model output", async () => {
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: '  "rewritten query"  ' }],
        }),
      },
    };
    const out = await rewriteQuery({ message: "x", history: [], client: mockClient as never });
    expect(out).toBe("rewritten query");
  });
});
