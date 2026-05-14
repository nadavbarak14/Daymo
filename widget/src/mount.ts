import styles from "./styles.css";
import { createChatState } from "./chat-state.js";
import { createApi, ApiError } from "./api.js";
import { renderParts } from "./render-parts.js";
import { getStrings, resolveLocale, type SupportedLocale } from "./locale.js";
import type { ChatResponse, WidgetConfigResp } from "./types.js";

export interface MountOpts {
  widgetId: string;
  baseUrl: string;
  localeOverride?: string;
}

export async function mount(opts: MountOpts): Promise<void> {
  const host = document.createElement("div");
  host.id = "daymo-widget-root";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);

  const locale: SupportedLocale = resolveLocale({
    override: opts.localeOverride,
    htmlLang: document.documentElement.lang,
    navigatorLang: navigator.language,
  });
  const strings = getStrings(locale);

  const api = createApi({ baseUrl: opts.baseUrl });
  const state = createChatState();

  let config: WidgetConfigResp | null = null;
  try {
    config = await api.getConfig(opts.widgetId);
  } catch { /* fall through with defaults */ }

  if (config?.brandColor) host.style.setProperty("--brand", config.brandColor);

  const bubble = document.createElement("button");
  bubble.className = "bubble";
  bubble.setAttribute("aria-label", strings.open);
  bubble.innerHTML = `<svg class="bubble-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  shadow.appendChild(bubble);

  let panel: HTMLDivElement | null = null;
  let thread: HTMLDivElement | null = null;
  let input: HTMLInputElement | null = null;
  let errorBanner: HTMLDivElement | null = null;
  let sendBtn: HTMLButtonElement | null = null;

  function buildPanel(): void {
    panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");

    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("span");
    title.id = "chat-title";
    title.textContent = config?.name ?? opts.widgetId;
    panel.setAttribute("aria-labelledby", "chat-title");
    header.appendChild(title);
    const closeBtn = document.createElement("button");
    closeBtn.className = "close";
    closeBtn.setAttribute("aria-label", strings.close);
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.addEventListener("click", () => state.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    errorBanner = document.createElement("div");
    errorBanner.className = "error-banner";
    errorBanner.style.display = "none";
    panel.appendChild(errorBanner);

    thread = document.createElement("div");
    thread.className = "thread";
    panel.appendChild(thread);

    const inputRow = document.createElement("div");
    inputRow.className = "input-row";
    input = document.createElement("input");
    input.type = "text";
    input.placeholder = strings.inputPlaceholder;
    input.setAttribute("aria-label", strings.inputPlaceholder);
    sendBtn = document.createElement("button");
    sendBtn.textContent = strings.send;
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    panel.appendChild(inputRow);

    function submit() {
      const text = input!.value.trim();
      if (!text) return;
      input!.value = "";
      state.submitMessage(text);
      sendChat(text);
    }
    sendBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    shadow.appendChild(panel);
  }

  function renderThread(): void {
    if (!thread) return;
    while (thread.firstChild) thread.removeChild(thread.firstChild);
    const s = state.getState();

    if (s.history.length === 0) {
      const greet = document.createElement("p");
      greet.className = "greeting";
      greet.textContent = strings.greeting;
      thread.appendChild(greet);
      const suggested = config?.suggestedQuestions ?? [];
      if (suggested.length > 0) {
        const header = document.createElement("div");
        header.className = "suggested-header";
        header.textContent = strings.suggestedHeader;
        thread.appendChild(header);
        const wrap = document.createElement("div");
        wrap.className = "suggestions";
        for (const q of suggested) {
          const btn = document.createElement("button");
          btn.textContent = q;
          btn.addEventListener("click", () => { input!.value = q; input!.focus(); });
          wrap.appendChild(btn);
        }
        thread.appendChild(wrap);
      }
    }

    for (let i = 0; i < s.history.length; i++) {
      const turn = s.history[i];
      if (turn.role === "user") {
        const el = document.createElement("div");
        el.className = "msg-user";
        el.textContent = turn.content;
        thread.appendChild(el);
      } else {
        const isLast = i === s.history.length - 1;
        const wrap = document.createElement("div");
        wrap.className = "msg-assistant";
        if (isLast && s.lastResponse) {
          if (s.lastResponse.kind === "answer") {
            renderParts(wrap, s.lastResponse.parts);
          } else {
            const p = document.createElement("p");
            p.textContent = `${strings.noMatchPrefix} ${s.lastResponse.text}`;
            wrap.appendChild(p);
            if (s.lastResponse.suggestions?.length) {
              const sugg = document.createElement("div");
              sugg.className = "suggestions";
              for (const q of s.lastResponse.suggestions) {
                const b = document.createElement("button");
                b.textContent = q;
                b.addEventListener("click", () => { input!.value = q; input!.focus(); });
                sugg.appendChild(b);
              }
              wrap.appendChild(sugg);
            }
          }
        } else {
          const p = document.createElement("p");
          p.textContent = turn.content;
          wrap.appendChild(p);
        }
        thread.appendChild(wrap);
      }
    }

    // Typing indicator while awaiting
    if (s.phase === "awaiting") {
      const typing = document.createElement("div");
      typing.className = "typing";
      typing.innerHTML = `<span></span><span></span><span></span>`;
      thread.appendChild(typing);
    }

    thread.scrollTop = thread.scrollHeight;
  }

  function renderError(): void {
    if (!errorBanner) return;
    const s = state.getState();
    if (s.phase !== "error") { errorBanner.style.display = "none"; return; }
    errorBanner.style.display = "block";
    errorBanner.textContent =
      s.errorKind === "ratelimit" ? strings.rateLimitMessage
        : s.errorKind === "not-configured" ? strings.notConfiguredMessage
          : strings.upstreamErrorMessage;
  }

  async function sendChat(text: string): Promise<void> {
    try {
      const resp: ChatResponse = await api.chat({
        widgetId: opts.widgetId,
        message: text,
        history: state.getState().history.slice(0, -1),
        locale,
      });
      state.receiveAnswer(resp);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) state.receiveError("ratelimit");
      else if (e instanceof ApiError && e.status === 404) state.receiveError("not-configured");
      else state.receiveError("upstream");
    }
  }

  state.subscribe(() => {
    const s = state.getState();
    if (s.phase === "closed") {
      if (panel) panel.style.display = "none";
      bubble.style.display = "flex";
    } else {
      if (!panel) buildPanel();
      panel!.style.display = "flex";
      bubble.style.display = "none";
      renderThread();
      renderError();
      if (sendBtn) sendBtn.disabled = (s.phase === "awaiting");
      if (s.phase === "open-idle" && input) input.focus();
    }
  });

  bubble.addEventListener("click", () => state.open());
}
