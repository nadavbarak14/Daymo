import type { ChatResponse } from "./types.js";

export type Phase = "closed" | "open-idle" | "awaiting" | "error";
export type ErrorKind = "ratelimit" | "upstream" | "not-configured";

export interface ChatStateSnapshot {
  phase: Phase;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  pendingMessage: string | null;
  lastResponse: ChatResponse | null;
  errorKind: ErrorKind | null;
}

const MAX_TURNS = 2;

export function createChatState() {
  let snap: ChatStateSnapshot = {
    phase: "closed",
    history: [],
    pendingMessage: null,
    lastResponse: null,
    errorKind: null,
  };
  const subs = new Set<(s: ChatStateSnapshot) => void>();
  function notify() { for (const fn of subs) fn(snap); }

  function trimHistory(h: ChatStateSnapshot["history"]): ChatStateSnapshot["history"] {
    const maxEntries = MAX_TURNS * 2;
    if (h.length <= maxEntries) return h;
    return h.slice(h.length - maxEntries);
  }

  function summarizeAnswer(resp: ChatResponse): string {
    if (resp.kind === "no_match") return resp.text;
    const firstText = resp.parts.find((p) => p.kind === "text");
    return firstText?.kind === "text" ? firstText.text : "(answer)";
  }

  return {
    getState() { return snap; },
    subscribe(fn: (s: ChatStateSnapshot) => void) { subs.add(fn); return () => subs.delete(fn); },
    open() {
      snap = { ...snap, phase: "open-idle" };
      notify();
    },
    close() {
      snap = { ...snap, phase: "closed" };
      notify();
    },
    submitMessage(text: string) {
      snap = {
        ...snap,
        phase: "awaiting",
        pendingMessage: text,
        history: trimHistory([...snap.history, { role: "user", content: text }]),
      };
      notify();
    },
    receiveAnswer(resp: ChatResponse) {
      snap = {
        ...snap,
        phase: "open-idle",
        pendingMessage: null,
        lastResponse: resp,
        history: trimHistory([...snap.history, { role: "assistant", content: summarizeAnswer(resp) }]),
      };
      notify();
    },
    receiveError(kind: ErrorKind) {
      snap = { ...snap, phase: "error", errorKind: kind };
      notify();
    },
    clearError() {
      snap = { ...snap, phase: "open-idle", errorKind: null };
      notify();
    },
  };
}
