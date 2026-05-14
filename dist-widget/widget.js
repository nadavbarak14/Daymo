// src/styles.css
var styles_default = ':host {\n  all: initial;\n  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;\n  color: #222;\n}\n.bubble {\n  position: fixed;\n  bottom: 16px;\n  right: 16px;\n  width: 52px;\n  height: 52px;\n  border-radius: 50%;\n  background: var(--brand, #6c5ce7);\n  color: #fff;\n  border: none;\n  cursor: pointer;\n  box-shadow: 0 4px 10px rgba(0,0,0,0.18);\n  font-size: 22px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 2147483647;\n}\n.bubble:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }\n.panel {\n  position: fixed;\n  bottom: 80px;\n  right: 16px;\n  width: 320px;\n  max-height: 480px;\n  background: #fff;\n  border-radius: 10px;\n  box-shadow: 0 8px 24px rgba(0,0,0,0.22);\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  z-index: 2147483647;\n}\n.panel-header {\n  background: var(--brand, #6c5ce7);\n  color: #fff;\n  padding: 8px 12px;\n  font-size: 13px;\n  font-weight: 600;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n.panel-header button { background: transparent; color: #fff; border: 0; cursor: pointer; font-size: 16px; }\n.thread {\n  flex: 1;\n  padding: 10px;\n  overflow-y: auto;\n  font-size: 13px;\n  line-height: 1.45;\n}\n.thread .msg-user {\n  background: #f0f0f4;\n  border-radius: 8px;\n  padding: 6px 9px;\n  margin: 4px 0 4px auto;\n  max-width: 80%;\n  text-align: right;\n  word-wrap: break-word;\n}\n.thread .msg-assistant { margin: 6px 0; }\n.thread .msg-assistant p { margin: 4px 0; }\n.video-wrap { margin: 6px 0; }\n.video-wrap video { width: 100%; max-height: 200px; background: #000; border-radius: 5px; }\n.caption { display: block; color: #666; font-size: 11px; margin-top: 2px; }\n.suggestions { display: flex; flex-direction: column; gap: 6px; margin: 6px 0; }\n.suggestions button {\n  text-align: left;\n  background: #f7f7fa;\n  border: 1px solid #e5e5ec;\n  border-radius: 6px;\n  padding: 6px 10px;\n  font-size: 12px;\n  cursor: pointer;\n}\n.input-row {\n  border-top: 1px solid #eee;\n  padding: 8px 10px;\n  display: flex;\n  gap: 6px;\n}\n.input-row input {\n  flex: 1;\n  border: 1px solid #ddd;\n  border-radius: 5px;\n  padding: 6px 8px;\n  font-size: 13px;\n}\n.input-row button {\n  background: var(--brand, #6c5ce7);\n  color: #fff;\n  border: 0;\n  border-radius: 5px;\n  padding: 6px 12px;\n  cursor: pointer;\n}\n.error-banner { background: #ffefef; color: #c00; padding: 6px 10px; font-size: 12px; }\n.greeting { color: #555; margin: 8px 0; }\n.suggested-header { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 8px; }\n\n@media (max-width: 600px) {\n  .bubble { width: 56px; height: 56px; bottom: 24px; right: 16px; }\n  .panel {\n    bottom: 0;\n    right: 0;\n    width: 100%;\n    height: 100dvh;\n    max-height: 100dvh;\n    border-radius: 0;\n    padding-bottom: env(safe-area-inset-bottom);\n  }\n  .panel-header button.minimize { display: none; }\n  .panel-header button.close { font-size: 20px; }\n}\n';

// src/chat-state.ts
var MAX_TURNS = 2;
function createChatState() {
  let snap = {
    phase: "closed",
    history: [],
    pendingMessage: null,
    lastResponse: null,
    errorKind: null
  };
  const subs = /* @__PURE__ */ new Set();
  function notify() {
    for (const fn of subs) fn(snap);
  }
  function trimHistory(h) {
    const maxEntries = MAX_TURNS * 2;
    if (h.length <= maxEntries) return h;
    return h.slice(h.length - maxEntries);
  }
  function summarizeAnswer(resp) {
    if (resp.kind === "no_match") return resp.text;
    const firstText = resp.parts.find((p) => p.kind === "text");
    return firstText?.kind === "text" ? firstText.text : "(answer)";
  }
  return {
    getState() {
      return snap;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    open() {
      snap = { ...snap, phase: "open-idle" };
      notify();
    },
    close() {
      snap = { ...snap, phase: "closed" };
      notify();
    },
    submitMessage(text) {
      snap = {
        ...snap,
        phase: "awaiting",
        pendingMessage: text,
        history: trimHistory([...snap.history, { role: "user", content: text }])
      };
      notify();
    },
    receiveAnswer(resp) {
      snap = {
        ...snap,
        phase: "open-idle",
        pendingMessage: null,
        lastResponse: resp,
        history: trimHistory([...snap.history, { role: "assistant", content: summarizeAnswer(resp) }])
      };
      notify();
    },
    receiveError(kind) {
      snap = { ...snap, phase: "error", errorKind: kind };
      notify();
    },
    clearError() {
      snap = { ...snap, phase: "open-idle", errorKind: null };
      notify();
    }
  };
}

// src/api.ts
var ApiError = class extends Error {
  constructor(status, retryAfterSec, message) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
};
async function callWithRetry(doIt, parseOk) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await doIt();
    if (res.ok) return parseOk(res);
    const retryAfterHeader = res.headers.get?.("Retry-After") ?? null;
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : 0;
    lastErr = new ApiError(res.status, retryAfterSec, `HTTP ${res.status}`);
    if (res.status !== 502) throw lastErr;
  }
  throw lastErr;
}
function createApi(opts) {
  const fetchFn = opts.fetchFn ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  return {
    async chat(req) {
      return callWithRetry(
        () => fetchFn(`${base}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req)
        }),
        (r) => r.json()
      );
    },
    async getConfig(widgetId) {
      return callWithRetry(
        () => fetchFn(`${base}/widget-config/${encodeURIComponent(widgetId)}`),
        (r) => r.json()
      );
    }
  };
}

// src/render-parts.ts
function renderParts(root, parts) {
  while (root.firstChild) root.removeChild(root.firstChild);
  for (const part of parts) {
    if (part.kind === "text") {
      const p = document.createElement("p");
      p.textContent = part.text;
      root.appendChild(p);
    } else {
      root.appendChild(renderVideoPart(part));
    }
  }
}
function renderVideoPart(part) {
  const wrap = document.createElement("div");
  wrap.className = "video-wrap";
  const v = document.createElement("video");
  const startSec = (part.startMs / 1e3).toFixed(3).replace(/\.?0+$/, "");
  const endSec = (part.endMs / 1e3).toFixed(3).replace(/\.?0+$/, "");
  v.src = `${part.mp4Url}#t=${startSec},${endSec}`;
  v.setAttribute("preload", "metadata");
  v.setAttribute("playsinline", "");
  v.controls = true;
  v.addEventListener("timeupdate", () => {
    if (v.currentTime >= part.endMs / 1e3) v.pause();
  });
  wrap.appendChild(v);
  const caption = document.createElement("small");
  caption.className = "caption";
  caption.textContent = part.caption;
  wrap.appendChild(caption);
  return wrap;
}

// src/locales/en.json
var en_default = {
  greeting: "Hi! Ask me how to do anything.",
  inputPlaceholder: "Type a question\u2026",
  send: "Send",
  open: "Open product help",
  close: "Close",
  back: "Back",
  suggestedHeader: "Try:",
  rateLimitMessage: "Too many questions \u2014 give me a moment.",
  upstreamErrorMessage: "Couldn't reach the assistant. Try again.",
  noMatchPrefix: "I don't have that in the demos. Try:",
  notConfiguredMessage: "This help widget is not configured.",
  caption: "Caption"
};

// src/locales/es.json
var es_default = {
  greeting: "\xA1Hola! Preg\xFAntame c\xF3mo hacer cualquier cosa.",
  inputPlaceholder: "Escribe una pregunta\u2026",
  send: "Enviar",
  open: "Abrir ayuda del producto",
  close: "Cerrar",
  back: "Atr\xE1s",
  suggestedHeader: "Prueba:",
  rateLimitMessage: "Demasiadas preguntas \u2014 dame un momento.",
  upstreamErrorMessage: "No pude contactar al asistente. Intenta de nuevo.",
  noMatchPrefix: "No tengo eso en las demos. Prueba:",
  notConfiguredMessage: "Este widget de ayuda no est\xE1 configurado.",
  caption: "Subt\xEDtulo"
};

// src/locales/fr.json
var fr_default = {
  greeting: "Bonjour ! Demandez-moi comment faire n'importe quoi.",
  inputPlaceholder: "Tapez une question\u2026",
  send: "Envoyer",
  open: "Ouvrir l'aide produit",
  close: "Fermer",
  back: "Retour",
  suggestedHeader: "Essayez :",
  rateLimitMessage: "Trop de questions \u2014 donnez-moi un instant.",
  upstreamErrorMessage: "Impossible de joindre l'assistant. R\xE9essayez.",
  noMatchPrefix: "Je n'ai pas \xE7a dans les d\xE9mos. Essayez :",
  notConfiguredMessage: "Ce widget d'aide n'est pas configur\xE9.",
  caption: "L\xE9gende"
};

// src/locales/de.json
var de_default = {
  greeting: "Hi! Frag mich, wie man etwas macht.",
  inputPlaceholder: "Stelle eine Frage\u2026",
  send: "Senden",
  open: "Produkthilfe \xF6ffnen",
  close: "Schlie\xDFen",
  back: "Zur\xFCck",
  suggestedHeader: "Versuche:",
  rateLimitMessage: "Zu viele Fragen \u2014 gib mir einen Moment.",
  upstreamErrorMessage: "Konnte den Assistenten nicht erreichen. Versuche es erneut.",
  noMatchPrefix: "Ich habe das nicht in den Demos. Versuche:",
  notConfiguredMessage: "Dieses Hilfe-Widget ist nicht konfiguriert.",
  caption: "Untertitel"
};

// src/locales/ja.json
var ja_default = {
  greeting: "\u3053\u3093\u306B\u3061\u306F\uFF01\u4F55\u3067\u3082\u8CEA\u554F\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  inputPlaceholder: "\u8CEA\u554F\u3092\u5165\u529B\u2026",
  send: "\u9001\u4FE1",
  open: "\u30D8\u30EB\u30D7\u3092\u958B\u304F",
  close: "\u9589\u3058\u308B",
  back: "\u623B\u308B",
  suggestedHeader: "\u4F8B:",
  rateLimitMessage: "\u8CEA\u554F\u304C\u591A\u3059\u304E\u307E\u3059 \u2014 \u5C11\u3057\u5F85\u3063\u3066\u304F\u3060\u3055\u3044\u3002",
  upstreamErrorMessage: "\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\u306B\u63A5\u7D9A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  noMatchPrefix: "\u30C7\u30E2\u306B\u305D\u308C\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3002\u304A\u8A66\u3057\u304F\u3060\u3055\u3044:",
  notConfiguredMessage: "\u3053\u306E\u30D8\u30EB\u30D7\u30A6\u30A3\u30B8\u30A7\u30C3\u30C8\u306F\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002",
  caption: "\u30AD\u30E3\u30D7\u30B7\u30E7\u30F3"
};

// src/locales/pt.json
var pt_default = {
  greeting: "Oi! Pergunte-me como fazer qualquer coisa.",
  inputPlaceholder: "Digite uma pergunta\u2026",
  send: "Enviar",
  open: "Abrir ajuda do produto",
  close: "Fechar",
  back: "Voltar",
  suggestedHeader: "Experimente:",
  rateLimitMessage: "Muitas perguntas \u2014 d\xEA-me um momento.",
  upstreamErrorMessage: "N\xE3o consegui contatar o assistente. Tente novamente.",
  noMatchPrefix: "N\xE3o tenho isso nas demos. Experimente:",
  notConfiguredMessage: "Este widget de ajuda n\xE3o est\xE1 configurado.",
  caption: "Legenda"
};

// src/locales/zh-CN.json
var zh_CN_default = {
  greeting: "\u4F60\u597D\uFF01\u8BF7\u95EE\u5982\u4F55\u64CD\u4F5C\uFF1F",
  inputPlaceholder: "\u8F93\u5165\u95EE\u9898\u2026",
  send: "\u53D1\u9001",
  open: "\u6253\u5F00\u4EA7\u54C1\u5E2E\u52A9",
  close: "\u5173\u95ED",
  back: "\u8FD4\u56DE",
  suggestedHeader: "\u8BD5\u8BD5\uFF1A",
  rateLimitMessage: "\u95EE\u9898\u592A\u591A \u2014 \u8BF7\u7A0D\u5019\u3002",
  upstreamErrorMessage: "\u65E0\u6CD5\u8FDE\u63A5\u5230\u52A9\u624B\u3002\u8BF7\u91CD\u8BD5\u3002",
  noMatchPrefix: "\u6F14\u793A\u4E2D\u6CA1\u6709\u76F8\u5173\u5185\u5BB9\u3002\u8BD5\u8BD5\uFF1A",
  notConfiguredMessage: "\u6B64\u5E2E\u52A9\u5C0F\u90E8\u4EF6\u672A\u914D\u7F6E\u3002",
  caption: "\u5B57\u5E55"
};

// src/locales/it.json
var it_default = {
  greeting: "Ciao! Chiedimi come fare qualsiasi cosa.",
  inputPlaceholder: "Digita una domanda\u2026",
  send: "Invia",
  open: "Apri aiuto prodotto",
  close: "Chiudi",
  back: "Indietro",
  suggestedHeader: "Prova:",
  rateLimitMessage: "Troppe domande \u2014 un attimo.",
  upstreamErrorMessage: "Impossibile raggiungere l'assistente. Riprova.",
  noMatchPrefix: "Non ho quello nelle demo. Prova:",
  notConfiguredMessage: "Questo widget di aiuto non \xE8 configurato.",
  caption: "Didascalia"
};

// src/locale.ts
var BUNDLES = {
  en: en_default,
  es: es_default,
  fr: fr_default,
  de: de_default,
  ja: ja_default,
  pt: pt_default,
  "zh-CN": zh_CN_default,
  it: it_default
};
function getStrings(locale) {
  if (locale in BUNDLES) return BUNDLES[locale];
  return BUNDLES.en;
}
function resolveLocale(input) {
  const candidates = [input.override, input.htmlLang, input.navigatorLang].filter(Boolean);
  for (const c of candidates) {
    if (c in BUNDLES) return c;
    const short = c.split("-")[0];
    if (short in BUNDLES) return short;
  }
  return "en";
}

// src/mount.ts
async function mount(opts) {
  const host = document.createElement("div");
  host.id = "daymo-widget-root";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = styles_default;
  shadow.appendChild(style);
  const locale = resolveLocale({
    override: opts.localeOverride,
    htmlLang: document.documentElement.lang,
    navigatorLang: navigator.language
  });
  const strings = getStrings(locale);
  const api = createApi({ baseUrl: opts.baseUrl });
  const state = createChatState();
  let config = null;
  try {
    config = await api.getConfig(opts.widgetId);
  } catch {
  }
  if (config?.brandColor) host.style.setProperty("--brand", config.brandColor);
  const bubble = document.createElement("button");
  bubble.className = "bubble";
  bubble.setAttribute("aria-label", strings.open);
  bubble.textContent = "?";
  shadow.appendChild(bubble);
  let panel = null;
  let thread = null;
  let input = null;
  let errorBanner = null;
  function buildPanel() {
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
    closeBtn.textContent = "\u2715";
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
    const sendBtn = document.createElement("button");
    sendBtn.textContent = strings.send;
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    panel.appendChild(inputRow);
    function submit() {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      state.submitMessage(text);
      sendChat(text);
    }
    sendBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    shadow.appendChild(panel);
  }
  function renderThread() {
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
          btn.addEventListener("click", () => {
            input.value = q;
            input.focus();
          });
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
                b.addEventListener("click", () => {
                  input.value = q;
                  input.focus();
                });
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
    thread.scrollTop = thread.scrollHeight;
  }
  function renderError() {
    if (!errorBanner) return;
    const s = state.getState();
    if (s.phase !== "error") {
      errorBanner.style.display = "none";
      return;
    }
    errorBanner.style.display = "block";
    errorBanner.textContent = s.errorKind === "ratelimit" ? strings.rateLimitMessage : s.errorKind === "not-configured" ? strings.notConfiguredMessage : strings.upstreamErrorMessage;
  }
  async function sendChat(text) {
    try {
      const resp = await api.chat({
        widgetId: opts.widgetId,
        message: text,
        history: state.getState().history.slice(0, -1),
        locale
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
      panel.style.display = "flex";
      bubble.style.display = "none";
      renderThread();
      renderError();
      if (s.phase === "open-idle" && input) input.focus();
    }
  });
  bubble.addEventListener("click", () => state.open());
}

// src/widget.ts
function init() {
  const script = document.currentScript ?? document.querySelector("script[data-widget-id]");
  if (!script) {
    console.warn("[daymo-widget] script tag with data-widget-id not found");
    return;
  }
  const widgetId = script.getAttribute("data-widget-id");
  const baseUrl = script.getAttribute("data-base-url") ?? new URL(script.src).origin;
  const locale = script.getAttribute("data-locale") ?? void 0;
  if (!widgetId) {
    console.warn("[daymo-widget] data-widget-id is required");
    return;
  }
  mount({ widgetId, baseUrl, localeOverride: locale ?? void 0 }).catch((err) => {
    console.error("[daymo-widget] mount failed:", err);
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
//# sourceMappingURL=widget.js.map
