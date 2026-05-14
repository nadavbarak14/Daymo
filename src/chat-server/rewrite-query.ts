import type Anthropic from "@anthropic-ai/sdk";

export interface RewriteQueryOpts {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  client: Anthropic;
}

const SYSTEM = `You rewrite the user's latest message into a single self-contained search query that captures their full intent given prior conversation turns. Output ONLY the query — no preamble, no quoting, no punctuation beyond what's strictly needed. Keep it <=30 tokens.`;

export async function rewriteQuery(opts: RewriteQueryOpts): Promise<string> {
  const historyText = opts.history
    .map((t) => `${t.role}: ${t.content}`)
    .join("\n");
  const userBlock = [
    historyText ? `Conversation so far:\n${historyText}\n` : "",
    `Latest message: ${opts.message}`,
    "",
    "Search query:",
  ].join("\n");

  const resp = await opts.client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 64,
    system: SYSTEM,
    messages: [{ role: "user", content: userBlock }],
  });
  const block = resp.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
  const raw = block?.text ?? "";
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}
