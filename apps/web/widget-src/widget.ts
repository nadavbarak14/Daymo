import type { WidgetConfigResponse } from "../../../src/core/index-types.js";

(function init() {
  const scripts = Array.from(document.querySelectorAll('script[data-company-id]'));
  const tag = scripts[scripts.length - 1] as HTMLScriptElement | undefined;
  if (!tag) return;
  const companyId = tag.dataset.companyId!;
  const apiBase = new URL(tag.src).origin;

  const root = document.createElement("div");
  root.id = "daymo-widget-root";
  root.style.cssText = "all: initial; position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;";
  document.body.appendChild(root);
  const shadow = root.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .bubble { width: 52px; height: 52px; border-radius: 50%; background: #2563eb; color: #fff; border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.2); font-size: 22px; }
      .panel { display: none; width: 320px; max-height: 480px; background: #fff; border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.18); padding: 12px; font-family: system-ui, sans-serif; overflow: auto; }
      .panel.open { display: block; }
      @media (max-width: 600px) {
        .panel.open { position: fixed; inset: 0; width: 100vw; height: 100vh; max-height: none; border-radius: 0; }
      }
      .panel header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .panel header h2 { margin: 0; font-size: 1rem; }
      .panel header button { background: none; border: none; cursor: pointer; font-size: 18px; }
      .messages { display: flex; flex-direction: column; gap: 8px; }
      .msg.user { align-self: flex-end; background: #eef; padding: 6px 10px; border-radius: 12px; max-width: 80%; }
      .msg.assistant { align-self: flex-start; max-width: 100%; }
      form { display: flex; gap: 6px; margin-top: 8px; }
      input { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid #ccc; font-size: 14px; }
      button.send { padding: 8px 12px; border: none; background: #2563eb; color: #fff; border-radius: 8px; cursor: pointer; }
      video { width: 100%; border-radius: 6px; background: #000; }
      .chip { display: inline-block; padding: 6px 10px; border: 1px solid #ddd; border-radius: 999px; background: #fafafa; margin: 4px 4px 0 0; cursor: pointer; font-size: 13px; }
    </style>
    <button class="bubble" aria-label="Open product help">?</button>
    <div class="panel" role="dialog" aria-modal="false" aria-labelledby="dwc-title">
      <header><h2 id="dwc-title">Help</h2><button class="close" aria-label="Close">×</button></header>
      <div class="chips"></div>
      <div class="messages"></div>
      <form><input aria-label="Ask a question" placeholder="Ask…" /><button class="send" type="submit">Ask</button></form>
    </div>
  `;

  const bubble = shadow.querySelector(".bubble") as HTMLButtonElement;
  const panel = shadow.querySelector(".panel") as HTMLDivElement;
  const close = shadow.querySelector(".close") as HTMLButtonElement;
  const chipsEl = shadow.querySelector(".chips") as HTMLDivElement;
  const messages = shadow.querySelector(".messages") as HTMLDivElement;
  const form = shadow.querySelector("form") as HTMLFormElement;
  const input = shadow.querySelector("input") as HTMLInputElement;

  let opened = false;
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];

  bubble.addEventListener("click", async () => {
    panel.classList.add("open");
    if (!opened) {
      opened = true;
      const res = await fetch(`${apiBase}/api/widget-config?companyId=${encodeURIComponent(companyId)}`);
      if (res.ok) {
        const cfg = (await res.json()) as WidgetConfigResponse;
        (shadow.querySelector("#dwc-title") as HTMLElement).textContent = cfg.name;
        chipsEl.innerHTML = cfg.suggestedQuestions
          .map((q) => `<span class="chip" data-q="${q.replace(/"/g, '&quot;')}">${q}</span>`)
          .join("");
        chipsEl.querySelectorAll(".chip").forEach((el) => {
          el.addEventListener("click", () => { input.value = el.getAttribute("data-q") ?? ""; input.focus(); });
        });
      }
    }
  });

  close.addEventListener("click", () => panel.classList.remove("open"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    const userDiv = document.createElement("div");
    userDiv.className = "msg user";
    userDiv.textContent = text;
    messages.appendChild(userDiv);
    chipsEl.innerHTML = "";

    const res = await fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId, message: text, history: history.slice(-2) }),
    });
    if (!res.ok) {
      const err = document.createElement("div");
      err.className = "msg assistant";
      err.textContent = "Something went wrong.";
      messages.appendChild(err);
      return;
    }
    const response = await res.json();
    const wrap = document.createElement("div");
    wrap.className = "msg assistant";
    if (response.kind === "answer") {
      for (const p of response.parts) {
        if (p.kind === "text") {
          const para = document.createElement("p");
          para.textContent = p.text;
          wrap.appendChild(para);
        } else {
          const v = document.createElement("video");
          v.src = `${p.mp4Url}#t=${p.startMs / 1000},${p.endMs / 1000}`;
          v.preload = "metadata";
          v.controls = true;
          v.playsInline = true;
          v.addEventListener("timeupdate", () => { if (v.currentTime * 1000 >= p.endMs) v.pause(); });
          wrap.appendChild(v);
          if (p.caption) {
            const cap = document.createElement("small");
            cap.textContent = p.caption;
            wrap.appendChild(cap);
          }
        }
      }
      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: response.parts.filter((p: any) => p.kind === "text").map((p: any) => p.text).join(" ") });
    } else {
      const para = document.createElement("p");
      para.textContent = response.text;
      wrap.appendChild(para);
    }
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  });
})();
