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

  function highlight(selector, durationMs, color) {
    const el = document.querySelector(selector);
    if (!el) return false;
    if (color) {
      // Inline override (beats the .__daymo-highlight rule on specificity tie
      // because inline styles always win). Saved+restored so we don't leak.
      const prevOutline = el.style.outline;
      const prevOffset = el.style.outlineOffset;
      const prevTransition = el.style.transition;
      el.style.outline = "3px solid " + color;
      el.style.outlineOffset = "2px";
      el.style.transition = "outline 0.2s ease";
      setTimeout(() => {
        el.style.outline = prevOutline;
        el.style.outlineOffset = prevOffset;
        el.style.transition = prevTransition;
      }, durationMs);
    } else {
      el.classList.add("__daymo-highlight");
      setTimeout(() => el.classList.remove("__daymo-highlight"), durationMs);
    }
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
    banner: showBanner, hideBanner,
  });
})();
`;
