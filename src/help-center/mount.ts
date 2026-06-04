import type { ChatResponse } from "../types.js";
import type { HelpManifest } from "../publish/types.js";
import { buildGalleryModel, type GalleryCard } from "./gallery-model.js";

export interface HelpCenterOptions {
  manifestUrl: string;
  chatEndpoint: string;
  title?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

type Turn = { role: "user" | "assistant"; content: string };

/** Render the full-page help center (gallery + chat) into `container`.
 *  Returns an unmount function. Framework-agnostic vanilla DOM. */
export function mountHelpCenter(container: HTMLElement, opts: HelpCenterOptions): () => void {
  const doc = container.ownerDocument;
  const fetchFn = opts.fetchImpl ?? fetch;

  const root = doc.createElement("div");
  root.className = "daymo-help";

  if (opts.title) {
    const h = doc.createElement("h1");
    h.className = "daymo-help-title";
    h.textContent = opts.title;
    root.appendChild(h);
  }

  const gallery = doc.createElement("div");
  gallery.className = "daymo-help-gallery";
  root.appendChild(gallery);

  const history: Turn[] = [];
  const chat = buildChat(doc, opts, fetchFn, history);
  root.appendChild(chat.el);

  container.appendChild(root);

  let cancelled = false;
  void fetchFn(opts.manifestUrl)
    .then((r) => r.json() as Promise<HelpManifest>)
    .then((manifest) => {
      if (cancelled) return;
      const model = buildGalleryModel(manifest);
      for (const card of model.cards) gallery.appendChild(renderCard(doc, card));
    })
    .catch(() => {
      /* leave gallery empty on failure */
    });

  return () => {
    cancelled = true;
    if (root.parentNode) root.parentNode.removeChild(root);
  };
}

function renderCard(doc: Document, card: GalleryCard): HTMLElement {
  const article = doc.createElement("article");
  article.className = "daymo-help-card";
  article.setAttribute("data-demo-id", card.demoId);

  const poster = doc.createElement("img");
  poster.className = "daymo-help-poster";
  poster.src = card.posterUrl;
  poster.alt = card.title;
  article.appendChild(poster);

  const title = doc.createElement("h3");
  title.textContent = card.title;
  article.appendChild(title);

  const desc = doc.createElement("p");
  desc.textContent = card.description;
  article.appendChild(desc);

  const meta = doc.createElement("small");
  meta.textContent = `${card.durationLabel} · ${card.stepCount} steps`;
  article.appendChild(meta);

  article.addEventListener("click", () => {
    const existing = article.querySelector("video");
    if (existing) return;
    const video = doc.createElement("video");
    video.controls = true;
    video.src = card.videoUrl;
    article.appendChild(video);
  });

  return article;
}

interface ChatUI {
  el: HTMLElement;
}

function buildChat(
  doc: Document,
  opts: HelpCenterOptions,
  fetchFn: typeof fetch,
  history: Turn[],
): ChatUI {
  const wrap = doc.createElement("div");
  wrap.className = "daymo-help-chat";

  const thread = doc.createElement("div");
  thread.className = "daymo-help-thread";
  wrap.appendChild(thread);

  const form = doc.createElement("form");
  const input = doc.createElement("input");
  input.type = "text";
  input.placeholder = "Ask: how do I…?";
  input.className = "daymo-help-input";
  const send = doc.createElement("button");
  send.type = "submit";
  send.textContent = "Ask";
  form.appendChild(input);
  form.appendChild(send);
  wrap.appendChild(form);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    appendUser(doc, thread, message);
    history.push({ role: "user", content: message });

    void fetchFn(opts.chatEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, history: history.slice(-2) }),
    })
      .then((r) => r.json() as Promise<ChatResponse>)
      .then((resp) => renderResponse(doc, thread, resp, history))
      .catch(() => {
        const err = doc.createElement("p");
        err.className = "daymo-help-error";
        err.textContent = "Couldn't reach the assistant. Try again.";
        thread.appendChild(err);
      });
  });

  return { el: wrap };
}

function appendUser(doc: Document, thread: HTMLElement, text: string): void {
  const p = doc.createElement("p");
  p.className = "daymo-help-user";
  p.textContent = text;
  thread.appendChild(p);
}

function renderResponse(doc: Document, thread: HTMLElement, resp: ChatResponse, history: Turn[]): void {
  if (resp.kind === "no_match") {
    const p = doc.createElement("p");
    p.className = "daymo-help-assistant";
    p.textContent = resp.text;
    thread.appendChild(p);
    for (const s of resp.suggestions ?? []) {
      const chip = doc.createElement("button");
      chip.type = "button";
      chip.className = "daymo-help-chip";
      chip.textContent = s;
      thread.appendChild(chip);
    }
    history.push({ role: "assistant", content: resp.text });
    return;
  }

  const summary: string[] = [];
  for (const part of resp.parts) {
    if (part.kind === "text") {
      const p = doc.createElement("p");
      p.className = "daymo-help-assistant";
      p.textContent = part.text;
      thread.appendChild(p);
      summary.push(part.text);
    } else {
      const video = doc.createElement("video");
      video.controls = true;
      video.src = `${part.mp4Url}#t=${part.startMs / 1000},${part.endMs / 1000}`;
      thread.appendChild(video);
      if (part.caption) {
        const cap = doc.createElement("small");
        cap.textContent = part.caption;
        thread.appendChild(cap);
      }
    }
  }
  history.push({ role: "assistant", content: summary.join(" ") });
}
