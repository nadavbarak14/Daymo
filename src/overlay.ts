// src/overlay.ts
//
// Source string of a script registered via `context.addInitScript()`. Defines
// `window.__daymo` — imperative methods the runner invokes via page.evaluate.
//
// The script runs in EVERY page context (top frame + iframes), but the runner
// only ever calls into the top frame's __daymo.
export const OVERLAY_INIT_SCRIPT = String.raw`
(() => {
  if (window.__daymo) return;

  const root = document.createElement("div");
  root.id = "daymo-overlay";
  root.style.cssText = [
    "position:fixed",
    "inset:0",
    "pointer-events:none",
    "z-index:2147483647",
  ].join(";");
  let mounted = false;
  function mount() {
    if (mounted) return;
    document.body.appendChild(root);
    mounted = true;
  }

  // Cursor — an SVG element absolutely positioned over the page.
  const cursor = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cursor.setAttribute("width", "24");
  cursor.setAttribute("height", "24");
  cursor.setAttribute("viewBox", "0 0 24 24");
  cursor.style.cssText = [
    "position:absolute",
    "top:0;left:0",
    "transform:translate(-9999px,-9999px)",
    "transition:transform 0.4s cubic-bezier(0.22,1,0.36,1)",
  ].join(";");
  cursor.innerHTML = '<path d="M2 2 L2 18 L7 13 L11 22 L13 21 L9 12 L17 12 Z" fill="#111" stroke="#fff" stroke-width="1.5"/>';
  root.appendChild(cursor);

  // Highlight — toggle a class on the target with an injected stylesheet.
  const style = document.createElement("style");
  style.textContent = ".__daymo-highlight { outline: 3px solid #ff5b5b !important; outline-offset: 2px !important; transition: outline 0.2s ease !important; }";
  function attachStyle() {
    if (document.head) document.head.appendChild(style);
    else document.addEventListener("DOMContentLoaded", () => document.head && document.head.appendChild(style));
  }
  attachStyle();

  // Callout layer — bubbles with arrows.
  const callouts = document.createElement("div");
  root.appendChild(callouts);

  // Caption banner — fixed at the bottom of the viewport.
  const captionBanner = document.createElement("div");
  captionBanner.style.cssText = [
    "position:absolute",
    "left:50%",
    "bottom:48px",
    "transform:translateX(-50%)",
    "max-width:80%",
    "padding:16px 24px",
    "background:rgba(15,23,42,0.92)",
    "color:#fff",
    "border-radius:12px",
    "font:18px/1.45 -apple-system,system-ui,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
    "opacity:0",
    "transition:opacity 0.3s ease",
    "white-space:pre-wrap",
  ].join(";");
  const captionTitle = document.createElement("div");
  captionTitle.style.cssText = "font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.7;margin-bottom:6px;";
  const captionBody = document.createElement("div");
  captionBanner.appendChild(captionTitle);
  captionBanner.appendChild(captionBody);
  root.appendChild(captionBanner);

  function moveCursor(x, y, durationMs) {
    mount();
    cursor.style.transitionDuration = (durationMs / 1000) + "s";
    cursor.style.transform = "translate(" + (x - 2) + "px," + (y - 2) + "px)";
  }

  function highlight(selector, durationMs) {
    const el = document.querySelector(selector);
    if (!el) return false;
    el.classList.add("__daymo-highlight");
    setTimeout(() => el.classList.remove("__daymo-highlight"), durationMs);
    return true;
  }

  function callout(text, target, durationMs) {
    mount();
    const bubble = document.createElement("div");
    bubble.style.cssText = [
      "position:absolute",
      "max-width:280px",
      "padding:10px 14px",
      "background:#111",
      "color:#fff",
      "font:14px/1.4 -apple-system,system-ui,sans-serif",
      "border-radius:8px",
      "box-shadow:0 6px 20px rgba(0,0,0,0.25)",
      "opacity:0",
      "transition:opacity 0.2s ease",
    ].join(";");
    bubble.textContent = text;
    callouts.appendChild(bubble);
    let x = 32, y = 32;
    if (target) {
      const el = document.querySelector(target);
      if (el) {
        const r = el.getBoundingClientRect();
        x = r.left + r.width / 2 - 140;
        y = r.bottom + 12;
      }
    }
    bubble.style.left = x + "px";
    bubble.style.top = y + "px";
    requestAnimationFrame(() => { bubble.style.opacity = "1"; });
    setTimeout(() => {
      bubble.style.opacity = "0";
      setTimeout(() => bubble.remove(), 250);
    }, durationMs);
  }

  function zoom(selector, factor, durationMs) {
    const el = selector ? document.querySelector(selector) : document.documentElement;
    if (!el) return false;
    const target = el === document.documentElement ? document.body : el;
    target.style.transition = "transform " + (durationMs / 1000) + "s ease";
    target.style.transformOrigin = "center center";
    target.style.transform = factor === 1 ? "" : "scale(" + factor + ")";
    return true;
  }

  function measure(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function showCaption(title, prose) {
    mount();
    captionTitle.textContent = title || "";
    captionBody.textContent = prose || "";
    requestAnimationFrame(() => { captionBanner.style.opacity = "1"; });
  }

  function hideCaption() {
    captionBanner.style.opacity = "0";
  }

  // Subtitle bar — separate from the legacy caption banner. Word-level karaoke.
  const subtitle = document.createElement("div");
  subtitle.setAttribute("data-daymo-subtitle", "");
  subtitle.style.cssText = [
    "position:absolute",
    "left:50%",
    "bottom:48px",
    "transform:translateX(-50%)",
    "max-width:80%",
    "padding:14px 22px",
    "background:rgba(15,23,42,0.92)",
    "color:#fff",
    "border-radius:12px",
    "font:18px/1.45 -apple-system,system-ui,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
    "opacity:0",
    "transition:opacity 0.2s ease",
    "white-space:pre-wrap",
  ].join(";");
  root.appendChild(subtitle);

  // Persistent banner (formerly auto-prose).
  const banner = document.createElement("div");
  banner.setAttribute("data-daymo-banner", "");
  banner.style.cssText = [
    "position:absolute",
    "left:50%",
    "bottom:140px",
    "transform:translateX(-50%)",
    "max-width:80%",
    "padding:14px 22px",
    "background:rgba(15,23,42,0.92)",
    "color:#fff",
    "border-radius:12px",
    "font:18px/1.45 -apple-system,system-ui,sans-serif",
    "box-shadow:0 8px 24px rgba(0,0,0,0.35)",
    "opacity:0",
    "transition:opacity 0.3s ease",
    "white-space:pre-wrap",
  ].join(";");
  const bannerTitle = document.createElement("div");
  bannerTitle.style.cssText = "font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.7;margin-bottom:6px;";
  const bannerBody = document.createElement("div");
  banner.appendChild(bannerTitle);
  banner.appendChild(bannerBody);
  root.appendChild(banner);

  let sayQueue = Promise.resolve();
  let sayQueueDepth = 0;

  function say(hash) {
    const entry = (window.__daymo && window.__daymo.sayTable || {})[hash];
    if (!entry) return Promise.reject(new Error("say: unknown hash " + hash));
    // If the queue is idle, mount the DOM (subtitle bar + word spans)
    // synchronously so callers observing the DOM immediately after calling
    // say() see the spans. Queued entries mount their DOM when their turn
    // comes (so they don't clobber the currently-playing entry).
    let prebuiltSpans = null;
    if (sayQueueDepth === 0) {
      prebuiltSpans = mountSayDom(entry);
    }
    sayQueueDepth++;
    const next = sayQueue.then(() => playSay(entry, prebuiltSpans)).finally(() => {
      sayQueueDepth--;
    });
    sayQueue = next;
    return next;
  }

  function mountSayDom(entry) {
    mount();
    subtitle.innerHTML = "";
    const spans = [];
    for (const w of entry.words) {
      const s = document.createElement("span");
      s.textContent = (w.word || w.text) + " ";
      s.style.transition = "color 0.05s linear, font-weight 0.05s linear";
      subtitle.appendChild(s);
      spans.push(s);
    }
    return spans;
  }

  function playSay(entry, prebuiltSpans) {
    return new Promise((resolve) => {
      // Use prebuilt spans if they're still mounted (queue depth was 0 at
      // schedule time). Otherwise rebuild — a previous entry has clobbered
      // the DOM, or we deferred.
      let spans = prebuiltSpans;
      if (!spans || subtitle.children.length !== entry.words.length) {
        spans = mountSayDom(entry);
      }
      requestAnimationFrame(() => { subtitle.style.opacity = "1"; });
      const t0 = performance.now();
      let idx = 0;
      function tick() {
        const t = performance.now() - t0;
        while (idx < entry.words.length && t >= entry.words[idx].startMs) {
          if (idx > 0) {
            spans[idx - 1].style.color = "#fff";
            spans[idx - 1].style.fontWeight = "400";
          }
          spans[idx].style.color = "#fbbf24";
          spans[idx].style.fontWeight = "700";
          idx++;
        }
        if (t < entry.durationMs) {
          requestAnimationFrame(tick);
        } else {
          setTimeout(() => { subtitle.style.opacity = "0"; }, 200);
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
  }

  function showBanner(text, durationMs, title) {
    mount();
    bannerTitle.textContent = title || "";
    bannerBody.textContent = text || "";
    requestAnimationFrame(() => { banner.style.opacity = "1"; });
    if (typeof durationMs === "number" && durationMs > 0) {
      setTimeout(() => { banner.style.opacity = "0"; }, durationMs);
    }
  }

  function hideBanner() {
    banner.style.opacity = "0";
  }

  window.__daymo = Object.assign({}, window.__daymo || {}, {
    moveCursor, highlight, callout, zoom, measure,
    showCaption, hideCaption,
    say, banner: showBanner, hideBanner,
    sayTable: (window.__daymo && window.__daymo.sayTable) || {},
  });
})();
`;
