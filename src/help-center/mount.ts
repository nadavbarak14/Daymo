import type { ChatResponse, VideoPart } from "../types.js";
import type { HelpManifest, ManifestDemo } from "../publish/types.js";
import { buildGalleryModel, formatDuration, type GalleryCard } from "./gallery-model.js";
import { DEFAULT_STRINGS, type HelpCenterStrings } from "./strings.js";
import { createPlayer } from "./player.js";
import { ICONS } from "./icons.js";

export interface HelpCenterOptions {
  manifestUrl: string;
  chatEndpoint: string;
  /** Product name in the appbar brand ("Acme Help"). */
  name?: string;
  /** Hero heading; defaults to "How can we help?". */
  title?: string;
  /** Brand color; set as --daymo-accent (all tints derive from it).
   *  Pair with a --daymo-accent-ink override for light brand colors. */
  brandColor?: string;
  /** Replaces the appbar mark and the assistant avatar (not the footer badge). */
  logoUrl?: string;
  /** "Popular:" chips under the ask bar; also the no-match fallback. */
  suggestedQuestions?: string[];
  /** Shows the appbar Contact button and footer link when set. */
  contactHref?: string;
  /** false drops appbar, footer and the mobile FAB (for hosts with chrome). */
  chrome?: boolean;
  /** Override any visible string (brand voice / i18n). */
  strings?: Partial<HelpCenterStrings>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

type Turn = { role: "user" | "assistant"; content: string };

const q = <T extends HTMLElement = HTMLElement>(scope: ParentNode, sel: string): T =>
  scope.querySelector(sel) as T;

/** Render the full help-center page (appbar, hero ask, chat thread, gallery,
 *  player modal, footer) into `container`. Returns an unmount function.
 *  Framework-agnostic vanilla DOM; no ids, no document-level listeners. */
export function mountHelpCenter(container: HTMLElement, opts: HelpCenterOptions): () => void {
  const doc = container.ownerDocument;
  const fetchFn = opts.fetchImpl ?? fetch;
  const strings: HelpCenterStrings = { ...DEFAULT_STRINGS, ...opts.strings };
  if (opts.title) strings.heroTitle = opts.title;
  const chrome = opts.chrome !== false;

  const root = doc.createElement("div");
  root.className = "daymo-help";

  const player = createPlayer(doc, strings);
  if (opts.brandColor) {
    root.style.setProperty("--daymo-accent", opts.brandColor);
    player.el.style.setProperty("--daymo-accent", opts.brandColor);
  }

  const demosById = new Map<string, ManifestDemo>();
  const history: Turn[] = [];
  let cancelled = false;
  // Chat turns are dispatched one at a time so each request's history reflects
  // the previous answer.
  let pending: Promise<unknown> = Promise.resolve();

  /* ---------- helpers ---------- */

  function brandMark(cls: string, logoUrl: string | undefined): HTMLElement {
    const mk = doc.createElement("span");
    mk.className = cls;
    if (logoUrl) {
      const img = doc.createElement("img");
      img.src = logoUrl;
      img.alt = "";
      mk.appendChild(img);
    } else {
      mk.innerHTML = ICONS.logo;
    }
    return mk;
  }

  function chip(label: string, onClick: () => void): HTMLButtonElement {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "daymo-help-chip";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  /* ---------- hero / ask ---------- */

  const hero = doc.createElement("section");
  hero.className = "daymo-help-hero";
  hero.innerHTML =
    `<div class="daymo-help-hero-bg"></div>` +
    `<div class="daymo-help-wrap">` +
    `<span class="daymo-help-eyebrow"><span class="daymo-help-dot"></span><span class="daymo-help-eyebrow-tx"></span></span>` +
    `<h1 class="daymo-help-h1"></h1>` +
    `<p class="daymo-help-lede"></p>` +
    `<div class="daymo-help-ask">` +
    `<form class="daymo-help-askbar">` +
    `<span class="daymo-help-lead">${ICONS.search}</span>` +
    `<input class="daymo-help-input" type="text" />` +
    `<button class="daymo-help-send" type="submit"><span class="daymo-help-send-tx"></span>${ICONS.arrow}</button>` +
    `</form>` +
    `<div class="daymo-help-suggest" hidden><span class="daymo-help-suggest-lbl"></span></div>` +
    `</div>` +
    `<div class="daymo-help-thread" aria-live="polite"></div>` +
    `</div>`;
  q(hero, ".daymo-help-eyebrow-tx").textContent = strings.eyebrow;
  q(hero, ".daymo-help-h1").textContent = strings.heroTitle;
  q(hero, ".daymo-help-lede").textContent = strings.lede;
  const input = q<HTMLInputElement>(hero, ".daymo-help-input");
  input.placeholder = strings.askPlaceholder;
  input.setAttribute("aria-label", strings.askButton);
  q(hero, ".daymo-help-send-tx").textContent = strings.askButton;
  q(hero, ".daymo-help-send").setAttribute("aria-label", strings.askButton);
  const thread = q(hero, ".daymo-help-thread");

  const suggest = q(hero, ".daymo-help-suggest");
  const suggested = opts.suggestedQuestions ?? [];
  if (suggested.length > 0) {
    suggest.hidden = false;
    q(suggest, ".daymo-help-suggest-lbl").textContent = strings.popularLabel;
    for (const s of suggested) suggest.appendChild(chip(s, () => ask(s)));
  }

  q(hero, ".daymo-help-askbar").addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });

  /* ---------- gallery ---------- */

  const gallerySec = doc.createElement("section");
  gallerySec.className = "daymo-help-section";
  gallerySec.hidden = true; // shown when the manifest yields demos
  gallerySec.innerHTML =
    `<div class="daymo-help-wrap">` +
    `<div class="daymo-help-sec-head"><div><h2></h2><p></p></div></div>` +
    `<div class="daymo-help-gallery"></div>` +
    `</div>`;
  q(gallerySec, "h2").textContent = strings.galleryHeading;
  q(gallerySec, ".daymo-help-sec-head p").textContent = strings.gallerySub;
  const gallery = q(gallerySec, ".daymo-help-gallery");

  function renderCard(card: GalleryCard): HTMLElement {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "daymo-help-card";
    btn.setAttribute("data-demo-id", card.demoId);
    btn.innerHTML =
      `<span class="daymo-help-poster">` +
      `<img alt="" />` +
      `<span class="daymo-help-play">${ICONS.play}</span>` +
      `<span class="daymo-help-dur"></span>` +
      `</span>` +
      `<span class="daymo-help-card-meta">` +
      `<span class="daymo-help-card-title"></span>` +
      `<span class="daymo-help-card-desc"></span>` +
      `<span class="daymo-help-card-foot">${ICONS.clock}<span></span></span>` +
      `</span>`;
    q<HTMLImageElement>(btn, "img").src = card.posterUrl;
    q(btn, ".daymo-help-dur").textContent = card.durationLabel;
    q(btn, ".daymo-help-card-title").textContent = card.title;
    q(btn, ".daymo-help-card-desc").textContent = card.description;
    q(btn, ".daymo-help-card-foot span").textContent =
      `${card.durationLabel} · ${card.stepCount} ${strings.stepsSuffix}`;
    btn.addEventListener("click", () => {
      const demo = demosById.get(card.demoId);
      if (demo) player.open(demo);
    });
    return btn;
  }

  /* ---------- chrome: appbar / footer / FAB ---------- */

  let appbar: HTMLElement | null = null;
  let footer: HTMLElement | null = null;
  let fab: HTMLButtonElement | null = null;
  let navBrowse: HTMLAnchorElement | null = null;
  let footAll: HTMLAnchorElement | null = null;

  function focusAsk(): void {
    hero.scrollIntoView?.({ behavior: "smooth" });
    input.focus();
  }
  function jumpGallery(e: Event): void {
    e.preventDefault();
    gallerySec.scrollIntoView?.({ behavior: "smooth" });
  }

  if (chrome) {
    appbar = doc.createElement("header");
    appbar.className = "daymo-help-appbar";
    appbar.innerHTML =
      `<div class="daymo-help-appbar-in">` +
      `<div class="daymo-help-brand"><span class="daymo-help-nm"></span></div>` +
      `<span class="daymo-help-spacer"></span>` +
      `<nav class="daymo-help-nav">` +
      `<a class="daymo-help-nav-link daymo-help-nav-browse" href="#" hidden></a>` +
      `<a class="daymo-help-nav-link daymo-help-nav-ask" href="#"></a>` +
      `</nav>` +
      `<a class="daymo-help-btn daymo-help-contact" hidden>${ICONS.contact}<span></span></a>` +
      `</div>`;
    const brand = q(appbar, ".daymo-help-brand");
    brand.insertBefore(brandMark("daymo-help-mk", opts.logoUrl), brand.firstChild);
    const nm = q(appbar, ".daymo-help-nm");
    if (opts.name) {
      nm.textContent = `${opts.name} `;
      const suffix = doc.createElement("span");
      suffix.textContent = strings.brandSuffix;
      nm.appendChild(suffix);
    } else {
      // No name: "Help" is the primary label (never an empty brand at ≤380px,
      // where the CSS hides only the suffix span).
      nm.textContent = strings.brandSuffix;
    }
    navBrowse = q<HTMLAnchorElement>(appbar, ".daymo-help-nav-browse");
    navBrowse.textContent = strings.navBrowse;
    navBrowse.addEventListener("click", jumpGallery);
    const navAsk = q<HTMLAnchorElement>(appbar, ".daymo-help-nav-ask");
    navAsk.textContent = strings.navAsk;
    navAsk.addEventListener("click", (e) => {
      e.preventDefault();
      focusAsk();
    });
    if (opts.contactHref) {
      const contact = q<HTMLAnchorElement>(appbar, ".daymo-help-contact");
      contact.hidden = false;
      contact.href = opts.contactHref;
      q(contact, "span").textContent = strings.contactLabel;
    }

    footer = doc.createElement("footer");
    footer.className = "daymo-help-footer";
    footer.innerHTML =
      `<div class="daymo-help-footer-in">` +
      `<div class="daymo-help-foot-links">` +
      `<a class="daymo-help-foot-all" href="#" hidden></a>` +
      `<a class="daymo-help-foot-contact" hidden></a>` +
      `</div>` +
      `<span class="daymo-help-built"><span class="daymo-help-mk">${ICONS.logo}</span><span class="daymo-help-built-tx"></span><b>Daymo</b></span>` +
      `</div>`;
    footAll = q<HTMLAnchorElement>(footer, ".daymo-help-foot-all");
    footAll.textContent = strings.footAllVideos;
    footAll.addEventListener("click", jumpGallery);
    q(footer, ".daymo-help-built-tx").textContent = `${strings.builtWith} `;
    if (opts.contactHref) {
      const fc = q<HTMLAnchorElement>(footer, ".daymo-help-foot-contact");
      fc.hidden = false;
      fc.href = opts.contactHref;
      fc.textContent = strings.footContact;
    }

    fab = doc.createElement("button");
    fab.type = "button";
    fab.className = "daymo-help-fab";
    fab.innerHTML = `${ICONS.chat}<span></span>`;
    q(fab, "span").textContent = strings.fabLabel;
    fab.addEventListener("click", focusAsk);
  }

  /* ---------- chat ---------- */

  function ask(message: string): void {
    message = message.trim();
    if (!message) return;
    input.value = "";

    const qa = doc.createElement("div");
    qa.className = "daymo-help-qa";
    qa.innerHTML =
      `<div class="daymo-help-q-row"><div class="daymo-help-q-bubble"></div></div>` +
      `<div class="daymo-help-a-row">` +
      `<div class="daymo-help-a-body">` +
      `<div class="daymo-help-a-name"><span class="daymo-help-a-nm"></span><span class="daymo-help-a-tag"></span></div>` +
      `<div class="daymo-help-a-text"><span class="daymo-help-typing"><i></i><i></i><i></i></span></div>` +
      `</div>` +
      `</div>`;
    q(qa, ".daymo-help-q-bubble").textContent = message;
    const aRow = q(qa, ".daymo-help-a-row");
    aRow.insertBefore(brandMark("daymo-help-a-av", opts.logoUrl), aRow.firstChild);
    q(qa, ".daymo-help-a-nm").textContent = strings.assistantName;
    q(qa, ".daymo-help-a-tag").textContent = strings.assistantTag;
    thread.appendChild(qa);
    qa.scrollIntoView?.({ behavior: "smooth", block: "nearest" });

    const body = q(qa, ".daymo-help-a-text");

    // Serialize turns: dispatch this request only after the previous turn has
    // settled, so the history we send always reflects the prior answer (turns
    // stay correctly ordered and the assistant content is present).
    pending = pending
      .catch(() => {})
      .then(() => {
        // history sent = turns BEFORE the current message
        const payload = JSON.stringify({ message, history: history.slice(-2) });
        history.push({ role: "user", content: message });
        return fetchFn(opts.chatEndpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        })
          .then((r) => r.json() as Promise<ChatResponse>)
          .then((resp) => {
            if (cancelled) return;
            renderResponse(body, resp);
          })
          .catch(() => {
            if (cancelled) return;
            body.textContent = "";
            const err = doc.createElement("p");
            err.className = "daymo-help-error";
            err.textContent = strings.errorText;
            body.appendChild(err);
          });
      });
  }

  function renderResponse(body: HTMLElement, resp: ChatResponse): void {
    body.textContent = ""; // removes the typing indicator
    if (resp.kind === "no_match") {
      const p = doc.createElement("p");
      p.className = "daymo-help-a-p";
      p.textContent = resp.text;
      body.appendChild(p);
      const suggestions =
        resp.suggestions && resp.suggestions.length > 0
          ? resp.suggestions
          : (opts.suggestedQuestions ?? []);
      if (suggestions.length > 0) {
        const row = doc.createElement("div");
        row.className = "daymo-help-a-chips";
        for (const s of suggestions) row.appendChild(chip(s, () => ask(s)));
        body.appendChild(row);
      }
      history.push({ role: "assistant", content: resp.text });
      return;
    }
    const summary: string[] = [];
    for (const part of resp.parts) {
      if (part.kind === "text") {
        const p = doc.createElement("p");
        p.className = "daymo-help-a-p";
        p.textContent = part.text;
        body.appendChild(p);
        summary.push(part.text);
      } else {
        body.appendChild(renderVideoPart(part));
      }
    }
    history.push({ role: "assistant", content: summary.join(" ") });
  }

  function renderVideoPart(part: VideoPart): HTMLElement {
    const demo = demosById.get(part.demoId);
    if (!demo) {
      // Manifest not loaded (or unknown demo): inline media-fragment fallback.
      const wrap = doc.createElement("div");
      wrap.className = "daymo-help-clip-fallback";
      const video = doc.createElement("video");
      video.controls = true;
      video.src = `${part.mp4Url}#t=${part.startMs / 1000},${part.endMs / 1000}`;
      wrap.appendChild(video);
      if (part.caption) {
        const cap = doc.createElement("small");
        cap.textContent = part.caption;
        wrap.appendChild(cap);
      }
      return wrap;
    }
    const clip = doc.createElement("button");
    clip.type = "button";
    clip.className = "daymo-help-clip";
    clip.innerHTML =
      `<span class="daymo-help-clip-thumb"><img alt="" /><span class="daymo-help-clip-play">${ICONS.play}</span></span>` +
      `<span class="daymo-help-clip-ci">` +
      `<span class="daymo-help-clip-cap"></span>` +
      `<span class="daymo-help-clip-sub"><b></b></span>` +
      `</span>`;
    q<HTMLImageElement>(clip, "img").src = demo.posterUrl;
    q(clip, ".daymo-help-clip-cap").textContent = part.caption;
    const sub = q(clip, ".daymo-help-clip-sub");
    sub.insertBefore(doc.createTextNode(`${demo.title} · `), sub.firstChild);
    q(sub, "b").textContent = `${formatDuration(part.startMs)}–${formatDuration(part.endMs)}`;
    clip.addEventListener("click", () =>
      player.open(demo, { startMs: part.startMs, endMs: part.endMs, autoplay: true }),
    );
    return clip;
  }

  /* ---------- manifest load ---------- */

  void fetchFn(opts.manifestUrl)
    .then((r) => r.json() as Promise<HelpManifest>)
    .then((manifest) => {
      if (cancelled) return;
      for (const d of manifest.demos) demosById.set(d.demoId, d);
      const model = buildGalleryModel(manifest);
      if (model.cards.length === 0) return; // gallery stays hidden
      gallerySec.hidden = false;
      if (navBrowse) navBrowse.hidden = false;
      if (footAll) footAll.hidden = false;
      for (const card of model.cards) gallery.appendChild(renderCard(card));
    })
    .catch(() => {
      /* gallery (and its jump links) stay hidden on failure */
    });

  /* ---------- assemble ---------- */

  if (appbar) root.appendChild(appbar);
  const main = doc.createElement("main");
  main.append(hero, gallerySec);
  root.appendChild(main);
  if (footer) root.appendChild(footer);
  if (fab) root.appendChild(fab);
  container.appendChild(root);

  return () => {
    cancelled = true;
    player.destroy();
    root.remove();
  };
}
