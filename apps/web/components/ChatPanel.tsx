"use client";
import { useState, useEffect, useRef } from "react";
import type { ChatRequest, ChatResponse, Part } from "../../../src/core/index-types.js";
import { VideoSegment } from "./VideoSegment.js";
import { SuggestionChips } from "./SuggestionChips.js";

type Msg = { role: "user"; content: string } | { role: "assistant"; response: ChatResponse };

export function ChatPanel({
  companyId,
  apiBase = "",
  suggestedQuestions,
  initialQuery,
}: {
  companyId: string;
  apiBase?: string;
  suggestedQuestions: string[];
  initialQuery?: string;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState(false);
  const submittedInitial = useRef(false);

  async function submit(text: string) {
    if (!text.trim() || pending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setPending(true);
    const history = messages.flatMap<{ role: "user" | "assistant"; content: string }>((m) =>
      m.role === "user" ? [{ role: "user", content: m.content }] : m.response.kind === "answer" ? [{ role: "assistant", content: m.response.parts.filter((p) => p.kind === "text").map((p: any) => p.text).join(" ") }] : []
    ).slice(-2);
    const body: ChatRequest = { companyId, message: text, history };
    try {
      const res = await fetch(`${apiBase}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", response: { kind: "no_match", text: "Something went wrong. Try again." } }]);
      } else {
        const response = (await res.json()) as ChatResponse;
        setMessages((m) => [...m, { role: "assistant", response }]);
      }
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    if (initialQuery && !submittedInitial.current) {
      submittedInitial.current = true;
      submit(initialQuery);
    }
  }, [initialQuery]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <SuggestionChips chips={messages.length === 0 ? suggestedQuestions : []} onPick={(c) => setInput(c)} />

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minHeight: "200px" }}>
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} style={{ alignSelf: "flex-end", background: "#eef", padding: "0.5rem 0.75rem", borderRadius: "12px", maxWidth: "80%" }}>{m.content}</div>
        ) : (
          <div key={i} style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
            {m.response.kind === "answer"
              ? m.response.parts.map((p: Part, j) => p.kind === "text"
                ? <p key={j} style={{ margin: "0.25rem 0" }}>{p.text}</p>
                : <VideoSegment key={j} part={p} />)
              : (
                <div>
                  <p style={{ margin: "0.25rem 0" }}>{m.response.text}</p>
                  {m.response.suggestions && <SuggestionChips chips={m.response.suggestions} onPick={(c) => setInput(c)} />}
                </div>
              )}
          </div>
        ))}
        {pending && <div style={{ alignSelf: "flex-start", color: "#888" }}>…</div>}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submit(input); }} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          aria-label="Ask a question"
          placeholder="Ask a question…"
          style={{ flex: 1, padding: "0.625rem 0.75rem", borderRadius: "8px", border: "1px solid #ccc", fontSize: "1rem" }}
        />
        <button type="submit" disabled={pending || !input.trim()} style={{
          padding: "0.625rem 1rem", borderRadius: "8px", border: "none",
          background: pending ? "#bbb" : "#2563eb", color: "#fff", cursor: pending ? "not-allowed" : "pointer",
        }}>Ask</button>
      </form>
    </div>
  );
}
