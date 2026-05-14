const ACTION_VERBS = new Set([
  "open", "close", "click", "create", "type", "submit", "fill", "add", "delete",
  "update", "send", "enable", "disable", "save", "cancel", "search", "choose",
  "select", "edit", "remove", "upload", "download", "share", "invite", "connect",
  "sign", "pay", "configure", "install", "run", "build", "deploy", "schedule",
  "export", "import", "copy", "paste", "insert", "reset", "refresh", "generate",
  "approve", "reject", "archive", "unarchive", "publish", "unpublish", "toggle",
  "set", "get", "find", "browse", "view", "see", "show", "check", "verify",
  "validate", "confirm", "switch", "move", "drag", "drop", "resize", "rotate",
  "print", "manage", "name", "rename", "duplicate", "filter", "sort", "group",
  "preview", "test", "launch", "stop", "start", "pause", "resume", "play",
  "record", "register", "log", "logout", "join", "leave",
]);

function isActionVerb(description: string): boolean {
  const firstWord = description.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return ACTION_VERBS.has(firstWord);
}

export function pickSuggestedQuestions(descriptions: string[]): string[] {
  const counts = new Map<string, number>();
  for (const d of descriptions) {
    if (!d || d === "(preamble)") continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const scored = Array.from(counts.entries()).map(([d, count]) => {
    const uniqueWords = new Set(d.toLowerCase().split(/\s+/).filter(Boolean)).size;
    return { d, score: uniqueWords * Math.log(1 + count) + uniqueWords * 0.01, isAction: isActionVerb(d) };
  });
  scored.sort((a, b) => b.score - a.score);

  // Prefer action-verb descriptions; fall back to others to fill up to 3 slots.
  const actions = scored.filter((s) => s.isAction).slice(0, 3);
  const fillers = scored.filter((s) => !s.isAction).slice(0, Math.max(0, 3 - actions.length));
  return [...actions, ...fillers].slice(0, 3).map(({ d }) => phraseAsQuestion(d));
}

function phraseAsQuestion(description: string): string {
  const lower = description.charAt(0).toLowerCase() + description.slice(1);
  const trimmed = lower.replace(/[.?!]+$/, "");
  return `How do I ${trimmed}?`;
}
