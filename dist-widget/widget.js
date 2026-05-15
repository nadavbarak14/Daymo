// src/styles.css
var styles_default = ':host {\n  all: initial;\n  font-family: "Inter", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif;\n  color: #0a0a0a;\n  font-feature-settings: "cv11", "ss01";\n}\n\n*, *::before, *::after { box-sizing: border-box; }\n\n/* ============================================================\n   FLOATING BUBBLE\n   ============================================================ */\n\n.bubble {\n  position: fixed;\n  bottom: 24px;\n  right: 24px;\n  width: 56px;\n  height: 56px;\n  border-radius: 50%;\n  background: #0a0a0a;\n  color: #fff;\n  border: none;\n  cursor: pointer;\n  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25), 0 2px 4px rgba(0, 0, 0, 0.06);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 2147483647;\n  transition: transform 180ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 180ms;\n}\n.bubble:hover {\n  transform: scale(1.05);\n  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);\n}\n.bubble:focus-visible {\n  outline: 2px solid #0a0a0a;\n  outline-offset: 3px;\n}\n.bubble svg { width: 22px; height: 22px; }\n\n/* ============================================================\n   CHAT PANEL\n   ============================================================ */\n\n.panel {\n  position: fixed;\n  bottom: 96px;\n  right: 24px;\n  width: 460px;\n  height: 660px;\n  max-height: calc(100vh - 120px);\n  background: #fff;\n  border-radius: 16px;\n  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.16), 0 8px 16px rgba(0, 0, 0, 0.06);\n  border: 1px solid rgba(0, 0, 0, 0.06);\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  z-index: 2147483647;\n  animation: slideUp 220ms cubic-bezier(0.16, 1, 0.3, 1);\n}\n@keyframes slideUp {\n  from { transform: translateY(12px); opacity: 0; }\n  to { transform: translateY(0); opacity: 1; }\n}\n\n/* Header */\n.panel-header {\n  padding: 14px 18px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  border-bottom: 1px solid #ececec;\n  flex-shrink: 0;\n  background: #fff;\n}\n.panel-header .title {\n  font-size: 14px;\n  font-weight: 600;\n  color: #0a0a0a;\n  letter-spacing: -0.01em;\n}\n.panel-header button {\n  background: transparent;\n  color: #71717a;\n  border: 0;\n  width: 32px;\n  height: 32px;\n  border-radius: 8px;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  transition: background 120ms, color 120ms;\n}\n.panel-header button:hover {\n  background: #f4f4f5;\n  color: #0a0a0a;\n}\n\n/* Thread */\n.thread {\n  flex: 1;\n  padding: 18px;\n  overflow-y: auto;\n  font-size: 14px;\n  line-height: 1.55;\n  color: #0a0a0a;\n  background: #fff;\n}\n.thread::-webkit-scrollbar { width: 6px; }\n.thread::-webkit-scrollbar-track { background: transparent; }\n.thread::-webkit-scrollbar-thumb {\n  background: rgba(0, 0, 0, 0.12);\n  border-radius: 3px;\n}\n.thread::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.22); }\n\n.greeting {\n  color: #52525b;\n  margin: 4px 0 18px;\n  font-size: 14px;\n  line-height: 1.6;\n}\n.suggested-header {\n  font-size: 11px;\n  color: #71717a;\n  text-transform: uppercase;\n  letter-spacing: 0.6px;\n  font-weight: 600;\n  margin: 16px 0 8px;\n}\n\n/* Messages */\n.msg-user, .msg-assistant {\n  margin: 12px 0;\n  animation: fadeIn 180ms ease-out;\n}\n@keyframes fadeIn {\n  from { opacity: 0; transform: translateY(4px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n.msg-user {\n  background: #f4f4f5;\n  color: #0a0a0a;\n  border-radius: 14px;\n  padding: 10px 14px;\n  margin-left: auto;\n  max-width: 85%;\n  width: fit-content;\n  display: block;\n  word-wrap: break-word;\n  font-weight: 400;\n}\n.msg-assistant {\n  color: #0a0a0a;\n}\n.msg-assistant p {\n  margin: 8px 0;\n  color: #0a0a0a;\n}\n\n/* Video card (clickable tile that opens the lightbox) */\n.video-card {\n  margin: 12px 0 16px;\n  border-radius: 14px;\n  overflow: hidden;\n  background: #0a0a0a;\n  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.10);\n  border: 1px solid rgba(0, 0, 0, 0.06);\n  padding: 0;\n  width: 100%;\n  text-align: left;\n  font-family: inherit;\n  cursor: pointer;\n  display: block;\n  transition: transform 140ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 140ms;\n}\n.video-card:hover {\n  transform: translateY(-1px);\n  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.14);\n}\n.video-card:focus-visible {\n  outline: 2px solid var(--brand, #0a0a0a);\n  outline-offset: 2px;\n}\n.video-card-header {\n  background: #fff;\n  padding: 10px 12px;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  border-bottom: 1px solid #ececec;\n}\n.video-card-header .play-icon {\n  width: 30px;\n  height: 30px;\n  border-radius: 50%;\n  background: var(--brand, #0a0a0a);\n  color: #fff;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  flex-shrink: 0;\n  transition: transform 140ms;\n}\n.video-card:hover .play-icon {\n  transform: scale(1.08);\n}\n.video-card-header .play-icon svg { width: 14px; height: 14px; margin-left: 2px; }\n.video-card-header .label {\n  font-size: 13px;\n  font-weight: 500;\n  color: #0a0a0a;\n  line-height: 1.35;\n  flex: 1;\n  min-width: 0;\n}\n.video-card-header .duration {\n  font-size: 11px;\n  color: #71717a;\n  font-variant-numeric: tabular-nums;\n  flex-shrink: 0;\n}\n.video-card video {\n  width: 100%;\n  height: 150px;\n  background: #0a0a0a;\n  display: block;\n  object-fit: cover;\n  object-position: center top;\n  pointer-events: none;\n}\n\n/* Lightbox overlay (big video on click) */\n.lightbox {\n  position: fixed;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.88);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  z-index: 2147483647;\n  animation: lightboxFade 180ms ease-out;\n  padding: 32px;\n}\n@keyframes lightboxFade {\n  from { opacity: 0; }\n  to { opacity: 1; }\n}\n.lightbox-inner {\n  position: relative;\n  width: min(86vw, 1200px);\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n}\n.lightbox video {\n  width: 100%;\n  aspect-ratio: 16 / 9;\n  background: #000;\n  border-radius: 12px;\n  display: block;\n  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);\n}\n.lightbox-caption {\n  color: #e4e4e7;\n  font-size: 14px;\n  text-align: center;\n  line-height: 1.45;\n}\n.lightbox-close {\n  position: absolute;\n  top: -44px;\n  right: 0;\n  background: rgba(255, 255, 255, 0.10);\n  border: 0;\n  width: 32px;\n  height: 32px;\n  border-radius: 50%;\n  color: #fff;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  transition: background 120ms;\n}\n.lightbox-close:hover { background: rgba(255, 255, 255, 0.22); }\n.lightbox-close svg { width: 16px; height: 16px; }\n\n/* Suggestion chips */\n.suggestions {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n  margin: 8px 0 16px;\n}\n.suggestions button {\n  text-align: left;\n  background: #fff;\n  border: 1px solid #ececec;\n  border-radius: 10px;\n  padding: 10px 12px;\n  font-size: 13px;\n  color: #0a0a0a;\n  cursor: pointer;\n  font-family: inherit;\n  transition: all 120ms;\n  line-height: 1.4;\n}\n.suggestions button:hover {\n  border-color: #d4d4d8;\n  background: #fafafa;\n}\n\n/* Typing */\n.typing {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 10px 4px;\n  margin: 8px 0;\n  width: fit-content;\n}\n.typing span {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: #a1a1aa;\n  animation: typingPulse 1.4s infinite ease-in-out;\n}\n.typing span:nth-child(2) { animation-delay: 0.2s; }\n.typing span:nth-child(3) { animation-delay: 0.4s; }\n@keyframes typingPulse {\n  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }\n  30% { transform: translateY(-4px); opacity: 1; }\n}\n\n/* Input row */\n.input-row {\n  border-top: 1px solid #ececec;\n  padding: 12px 14px;\n  background: #fff;\n  flex-shrink: 0;\n  position: relative;\n}\n.input-row input {\n  width: 100%;\n  border: 1px solid #ececec;\n  border-radius: 12px;\n  padding: 12px 48px 12px 14px;\n  font-size: 14px;\n  font-family: inherit;\n  color: #0a0a0a;\n  background: #fff;\n  transition: all 120ms;\n  outline: none;\n}\n.input-row input:focus {\n  border-color: #a1a1aa;\n  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.06);\n}\n.input-row input::placeholder {\n  color: #a1a1aa;\n}\n.input-row button {\n  position: absolute;\n  right: 22px;\n  top: 50%;\n  transform: translateY(-50%);\n  background: #0a0a0a;\n  color: #fff;\n  border: 0;\n  border-radius: 8px;\n  width: 32px;\n  height: 32px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  transition: all 120ms;\n}\n.input-row button:hover:not(:disabled) {\n  background: #27272a;\n}\n.input-row button:disabled {\n  opacity: 0.35;\n  cursor: not-allowed;\n}\n.input-row button svg { width: 14px; height: 14px; }\n\n/* Error banner */\n.error-banner {\n  background: #fef2f2;\n  color: #991b1b;\n  padding: 10px 14px;\n  font-size: 13px;\n  border-bottom: 1px solid #fee2e2;\n}\n\n/* Mobile */\n@media (max-width: 600px) {\n  .bubble { width: 56px; height: 56px; bottom: 20px; right: 16px; }\n  .panel {\n    bottom: 0;\n    right: 0;\n    width: 100%;\n    height: 100dvh;\n    max-height: 100dvh;\n    border-radius: 0;\n    padding-bottom: env(safe-area-inset-bottom);\n    animation: none;\n  }\n}\n';

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
function renderParts(root, parts, onPlay) {
  while (root.firstChild) root.removeChild(root.firstChild);
  for (const part of parts) {
    if (part.kind === "text") {
      const p = document.createElement("p");
      p.textContent = part.text;
      root.appendChild(p);
    } else {
      root.appendChild(renderVideoPart(part, onPlay));
    }
  }
}
function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1e3));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
function renderVideoPart(part, onPlay) {
  const card = document.createElement("button");
  card.className = "video-card";
  card.type = "button";
  card.setAttribute("aria-label", `Play clip: ${part.caption}`);
  const startSec = (part.startMs / 1e3).toFixed(3).replace(/\.?0+$/, "");
  const duration = formatDuration(part.endMs - part.startMs);
  const header = document.createElement("div");
  header.className = "video-card-header";
  const playIcon = document.createElement("span");
  playIcon.className = "play-icon";
  playIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = part.caption;
  const dur = document.createElement("span");
  dur.className = "duration";
  dur.textContent = duration;
  header.appendChild(playIcon);
  header.appendChild(label);
  header.appendChild(dur);
  const thumb = document.createElement("video");
  thumb.src = `${part.mp4Url}#t=${startSec}`;
  thumb.setAttribute("preload", "metadata");
  thumb.setAttribute("playsinline", "");
  thumb.muted = true;
  card.addEventListener("click", () => onPlay(part));
  card.appendChild(header);
  card.appendChild(thumb);
  return card;
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
  bubble.innerHTML = `<svg class="bubble-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  shadow.appendChild(bubble);
  let panel = null;
  let thread = null;
  let input = null;
  let errorBanner = null;
  let sendBtn = null;
  let lightbox = null;
  let lightboxVideo = null;
  let lightboxCaption = null;
  let lightboxClipEnd = null;
  function buildLightbox() {
    lightbox = document.createElement("div");
    lightbox.className = "lightbox";
    lightbox.style.display = "none";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    const inner = document.createElement("div");
    inner.className = "lightbox-inner";
    const closeBtn = document.createElement("button");
    closeBtn.className = "lightbox-close";
    closeBtn.setAttribute("aria-label", strings.close);
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.addEventListener("click", closeLightbox);
    inner.appendChild(closeBtn);
    lightboxVideo = document.createElement("video");
    lightboxVideo.controls = true;
    lightboxVideo.setAttribute("playsinline", "");
    lightboxVideo.addEventListener("timeupdate", () => {
      if (lightboxClipEnd !== null && lightboxVideo.currentTime >= lightboxClipEnd) {
        lightboxVideo.pause();
      }
    });
    inner.appendChild(lightboxVideo);
    lightboxCaption = document.createElement("div");
    lightboxCaption.className = "lightbox-caption";
    inner.appendChild(lightboxCaption);
    lightbox.appendChild(inner);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    shadow.appendChild(lightbox);
  }
  function openLightbox(part) {
    if (!lightbox) buildLightbox();
    const startSec = part.startMs / 1e3;
    const endSec = part.endMs / 1e3;
    lightboxClipEnd = endSec;
    lightboxVideo.src = `${part.mp4Url}#t=${startSec.toFixed(3)},${endSec.toFixed(3)}`;
    lightboxCaption.textContent = part.caption;
    lightbox.style.display = "flex";
    lightboxVideo.currentTime = startSec;
    lightboxVideo.play().catch(() => {
    });
  }
  function closeLightbox() {
    if (!lightbox || !lightboxVideo) return;
    lightboxVideo.pause();
    lightbox.style.display = "none";
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox && lightbox.style.display !== "none") {
      closeLightbox();
    }
  });
  function buildPanel() {
    panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    const header = document.createElement("div");
    header.className = "panel-header";
    const title = document.createElement("span");
    title.id = "chat-title";
    title.className = "title";
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
    sendBtn.setAttribute("aria-label", strings.send);
    sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
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
            renderParts(wrap, s.lastResponse.parts, openLightbox);
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
    if (s.phase === "awaiting") {
      const typing = document.createElement("div");
      typing.className = "typing";
      typing.innerHTML = `<span></span><span></span><span></span>`;
      thread.appendChild(typing);
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
      if (sendBtn) sendBtn.disabled = s.phase === "awaiting";
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
