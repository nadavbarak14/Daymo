import styles from "./styles.css";
import { createChatState } from "./chat-state.js";
import { createApi, ApiError } from "./api.js";
import { renderParts } from "./render-parts.js";
import { loadManifest, resolveVideoSource, type ManifestDemo } from "./manifest.js";
import { getStrings, resolveLocale, type SupportedLocale } from "./locale.js";
import type { ChatResponse, VideoPart, WidgetConfigResp } from "./types.js";

export interface MountOpts {
  widgetId: string;
  baseUrl: string;
  localeOverride?: string;
  /** Shipped theme name ("aurelia" | "lume" | "onyx"); wins over config.theme. */
  theme?: string;
  /** URL of the published help-center manifest.json; wins over config.manifestUrl. */
  manifestUrl?: string;
}

const CHAT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SEND_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;
const SPARK_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z"/></svg>`;

export async function mount(opts: MountOpts): Promise<void> {
  const host = document.createElement("div");
  host.id = "daymo-widget-root";
  host.setAttribute("data-open", "false");
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

  // Theming: data-theme attribute selects a shipped theme; brandColor (when no
  // theme is chosen) re-tints the default one. Host pages can override any
  // --dw-* token on #daymo-widget-root — tokens inherit through the shadow root.
  const theme = opts.theme ?? config?.theme;
  if (theme) {
    host.setAttribute("data-theme", theme);
  } else if (config?.brandColor) {
    host.style.setProperty("--dw-accent", config.brandColor);
    host.style.setProperty("--dw-bubble-bg", config.brandColor);
  }

  // Shared videos: when the product also publishes a help center, the widget
  // reads the same manifest.json — posters for answer cards and the exact
  // same output.mp4 files the help page plays. Best-effort and non-blocking.
  // Relative URLs resolve against the host page, exactly like the help
  // center's manifestUrl option (e.g. "/help/manifest.json").
  let demos: Map<string, ManifestDemo> = new Map();
  const manifestUrl = opts.manifestUrl ?? config?.manifestUrl;
  if (manifestUrl) {
    void loadManifest(manifestUrl).then((m) => {
      demos = m;
      if (state.getState().phase !== "closed") renderThread();
    });
  }

  const bubble = document.createElement("button");
  bubble.className = "dw-bubble";
  bubble.setAttribute("aria-label", strings.open);
  bubble.innerHTML = `${CHAT_SVG}<span class="dw-bubble-dot"></span>`;
  shadow.appendChild(bubble);

  let panel: HTMLDivElement | null = null;
  let thread: HTMLDivElement | null = null;
  let input: HTMLInputElement | null = null;
  let errorBanner: HTMLDivElement | null = null;
  let sendBtn: HTMLButtonElement | null = null;

  let lightbox: HTMLDivElement | null = null;
  let lightboxVideo: HTMLVideoElement | null = null;
  let lightboxCaption: HTMLDivElement | null = null;
  let lightboxClipEnd: number | null = null;

  function buildLightbox(): void {
    lightbox = document.createElement("div");
    lightbox.className = "dw-lightbox";
    lightbox.style.display = "none";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");

    const inner = document.createElement("div");
    inner.className = "dw-lb-inner";

    const closeBtn = document.createElement("button");
    closeBtn.className = "dw-lb-close";
    closeBtn.setAttribute("aria-label", strings.close);
    closeBtn.innerHTML = CLOSE_SVG;
    closeBtn.addEventListener("click", closeLightbox);
    inner.appendChild(closeBtn);

    lightboxVideo = document.createElement("video");
    lightboxVideo.controls = true;
    lightboxVideo.setAttribute("playsinline", "");
    lightboxVideo.addEventListener("timeupdate", () => {
      if (lightboxClipEnd !== null && lightboxVideo!.currentTime >= lightboxClipEnd) {
        lightboxVideo!.pause();
      }
    });
    inner.appendChild(lightboxVideo);

    lightboxCaption = document.createElement("div");
    lightboxCaption.className = "dw-lb-caption";
    inner.appendChild(lightboxCaption);

    lightbox.appendChild(inner);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });

    shadow.appendChild(lightbox);
  }

  function openLightbox(part: VideoPart): void {
    if (!lightbox) buildLightbox();
    const source = resolveVideoSource(part, demos);
    const startSec = part.startMs / 1000;
    const endSec = part.endMs / 1000;
    lightboxClipEnd = endSec;
    lightboxVideo!.src = `${source.mp4Url}#t=${startSec.toFixed(3)},${endSec.toFixed(3)}`;
    if (source.posterUrl) lightboxVideo!.poster = source.posterUrl;
    lightboxCaption!.textContent = "";
    const b = document.createElement("b");
    b.textContent = part.caption;
    lightboxCaption!.appendChild(b);
    if (source.title) lightboxCaption!.appendChild(document.createTextNode(` — ${source.title}`));
    lightbox!.style.display = "flex";
    lightboxVideo!.currentTime = startSec;
    lightboxVideo!.play().catch(() => { /* user can press native play */ });
  }

  function closeLightbox(): void {
    if (!lightbox || !lightboxVideo) return;
    lightboxVideo.pause();
    lightbox.style.display = "none";
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox && lightbox.style.display !== "none") {
      closeLightbox();
    }
  });

  function buildPanel(): void {
    panel = document.createElement("div");
    panel.className = "dw-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");

    const name = config?.name ?? opts.widgetId;

    const header = document.createElement("div");
    header.className = "dw-header";

    const mark = document.createElement("div");
    mark.className = "dw-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = name.trim().charAt(0).toUpperCase();
    header.appendChild(mark);

    const headText = document.createElement("div");
    headText.className = "dw-head-text";
    const title = document.createElement("div");
    title.id = "chat-title";
    title.className = "dw-title";
    title.textContent = name;
    panel.setAttribute("aria-labelledby", "chat-title");
    const subtitle = document.createElement("div");
    subtitle.className = "dw-subtitle";
    subtitle.textContent = strings.subtitle;
    headText.appendChild(title);
    headText.appendChild(subtitle);
    header.appendChild(headText);

    const closeBtn = document.createElement("button");
    closeBtn.className = "dw-close";
    closeBtn.setAttribute("aria-label", strings.close);
    closeBtn.innerHTML = CLOSE_SVG;
    closeBtn.addEventListener("click", () => state.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    errorBanner = document.createElement("div");
    errorBanner.className = "dw-error";
    errorBanner.style.display = "none";
    panel.appendChild(errorBanner);

    thread = document.createElement("div");
    thread.className = "dw-thread";
    panel.appendChild(thread);

    const inputRow = document.createElement("div");
    inputRow.className = "dw-input-row";
    input = document.createElement("input");
    input.className = "dw-input";
    input.type = "text";
    input.placeholder = strings.inputPlaceholder;
    input.setAttribute("aria-label", strings.inputPlaceholder);
    sendBtn = document.createElement("button");
    sendBtn.className = "dw-send";
    sendBtn.setAttribute("aria-label", strings.send);
    sendBtn.innerHTML = SEND_SVG;
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    panel.appendChild(inputRow);

    const footer = document.createElement("div");
    footer.className = "dw-footer-note";
    footer.appendChild(document.createTextNode(`${strings.footerNote} `));
    const brand = document.createElement("b");
    brand.textContent = "Daymo";
    footer.appendChild(brand);
    panel.appendChild(footer);

    function submit() {
      const text = input!.value.trim();
      if (!text) return;
      input!.value = "";
      ask(text);
    }
    sendBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    shadow.appendChild(panel);
  }

  function ask(text: string): void {
    if (state.getState().phase === "awaiting") return;
    state.submitMessage(text);
    void sendChat(text);
  }

  function makeChip(question: string): HTMLButtonElement {
    const chip = document.createElement("button");
    chip.className = "dw-chip";
    chip.innerHTML = SPARK_SVG;
    const label = document.createElement("span");
    label.textContent = question;
    chip.appendChild(label);
    chip.addEventListener("click", () => ask(question));
    return chip;
  }

  function renderThread(): void {
    if (!thread) return;
    while (thread.firstChild) thread.removeChild(thread.firstChild);
    const s = state.getState();

    if (s.history.length === 0) {
      const greet = document.createElement("div");
      greet.className = "dw-greeting";
      greet.textContent = strings.greeting;
      thread.appendChild(greet);
      const greetSub = document.createElement("div");
      greetSub.className = "dw-greeting-sub";
      greetSub.textContent = strings.greetingSub;
      thread.appendChild(greetSub);
      const suggested = config?.suggestedQuestions ?? [];
      if (suggested.length > 0) {
        const header = document.createElement("div");
        header.className = "dw-suggest-label";
        header.textContent = strings.suggestedHeader;
        thread.appendChild(header);
        const wrap = document.createElement("div");
        wrap.className = "dw-suggestions";
        for (const q of suggested) wrap.appendChild(makeChip(q));
        thread.appendChild(wrap);
      }
    }

    for (let i = 0; i < s.history.length; i++) {
      const turn = s.history[i];
      if (turn.role === "user") {
        const el = document.createElement("div");
        el.className = "dw-msg dw-msg-user";
        el.textContent = turn.content;
        thread.appendChild(el);
      } else {
        const isLast = i === s.history.length - 1;
        const wrap = document.createElement("div");
        wrap.className = "dw-msg dw-msg-assistant";
        if (isLast && s.lastResponse) {
          if (s.lastResponse.kind === "answer") {
            renderParts(wrap, s.lastResponse.parts, openLightbox, (p) => resolveVideoSource(p, demos));
          } else {
            const p = document.createElement("p");
            p.textContent = `${strings.noMatchPrefix} ${s.lastResponse.text}`;
            wrap.appendChild(p);
            if (s.lastResponse.suggestions?.length) {
              const sugg = document.createElement("div");
              sugg.className = "dw-suggestions";
              for (const q of s.lastResponse.suggestions) sugg.appendChild(makeChip(q));
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
      typing.className = "dw-typing";
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
      host.setAttribute("data-open", "false");
    } else {
      if (!panel) buildPanel();
      host.setAttribute("data-open", "true");
      renderThread();
      renderError();
      if (sendBtn) sendBtn.disabled = (s.phase === "awaiting");
      if (s.phase === "open-idle" && input) input.focus();
    }
  });

  bubble.addEventListener("click", () => state.open());
}
