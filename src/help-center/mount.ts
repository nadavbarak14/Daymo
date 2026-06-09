import type { ChatResponse } from "../types.js";
import type { HelpManifest, ManifestDemo } from "../publish/types.js";
import { formatDuration } from "./gallery-model.js";
import { DEFAULT_STRINGS, type HelpCenterStrings } from "./strings.js";
import { createPlayer, type PlayerCue } from "./player.js";
import { ICONS } from "./icons.js";
import { groupVideoParts, type DemoCardRef } from "./answer-cards.js";

export interface HelpCenterOptions {
  manifestUrl: string;
  chatEndpoint: string;
  /** Product name in the sidebar brand ("Acme Help"). */
  name?: string;
  /** Home greeting heading; defaults to "How can we help?". */
  title?: string;
  /** Brand color; set as --daymo-accent (all tints derive from it).
   *  Pair with a --daymo-accent-ink override for light brand colors. */
  brandColor?: string;
  /** Replaces the sidebar brand mark and the assistant avatar (not the footer badge). */
  logoUrl?: string;
  /** Popular-search chips on the home landing; also the no-match fallback. */
  suggestedQuestions?: string[];
  /** Shows the topbar Contact link when set. */
  contactHref?: string;
  /** false drops the sidebar + topbar so the content column (home + thread)
   *  can be embedded inside a host's own shell. */
  chrome?: boolean;
  /** Override any visible string (brand voice / i18n). */
  strings?: Partial<HelpCenterStrings>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

type Turn = { role: "user" | "assistant"; content: string };

const sq = <T extends HTMLElement = HTMLElement>(scope: ParentNode, sel: string): T =>
  scope.querySelector(sel) as T;

/** Render the full help-center page — a ChatGPT-style shell: a collapsible
 *  sidebar (video library + search), a centered home landing with an inline
 *  media player, a conversation thread with structured video answers, and a
 *  theater player modal. Returns an unmount function.
 *
 *  Framework-agnostic vanilla DOM; no element ids, no document-level listeners
 *  (so multiple mounts coexist and nothing leaks on unmount). */
export function mountHelpCenter(container: HTMLElement, opts: HelpCenterOptions): () => void {
  const doc = container.ownerDocument;
  const fetchFn = opts.fetchImpl ?? fetch;
  const strings: HelpCenterStrings = { ...DEFAULT_STRINGS, ...opts.strings };
  if (opts.title) strings.heroTitle = opts.title;
  const chrome = opts.chrome !== false;

  const root = doc.createElement("div");
  root.className = "daymo-help";
  root.dataset.sidebar = "open";

  let demos: ManifestDemo[] = [];
  const demosById = new Map<string, ManifestDemo>();

  const player = createPlayer(doc, strings, { queue: () => demos });
  if (opts.brandColor) {
    root.style.setProperty("--daymo-accent", opts.brandColor);
    player.el.style.setProperty("--daymo-accent", opts.brandColor);
  }

  const history: Turn[] = [];
  let messageCount = 0;
  let cancelled = false;
  // Chat turns are dispatched one at a time so each request's history reflects
  // the previous answer.
  let pending: Promise<unknown> = Promise.resolve();

  /* ---------- small DOM helpers ---------- */

  // NOTE: every innerHTML string below is a single template literal, never a
  // "+"-chain of literals. Concatenating template-literal operands with "+"
  // trips a constant-folding bug in SWC/Turbopack minification (Next 16) that
  // silently DROPS a non-interpolated operand sandwiched between interpolated
  // ones — it blanked the page in a consumer's production build. Keep them
  // single literals.
  function el(tag: string, cls?: string, html?: string): HTMLElement {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function brandMark(cls: string, icon: string): HTMLElement {
    const mk = el("span", cls);
    if (opts.logoUrl) {
      const img = doc.createElement("img");
      img.src = opts.logoUrl;
      img.alt = "";
      mk.appendChild(img);
    } else {
      mk.innerHTML = icon;
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
  function durSteps(d: ManifestDemo): string {
    return `${formatDuration(d.durationMs)} · ${d.steps.length} ${strings.stepsSuffix}`;
  }
  function openPlayer(d: ManifestDemo, cue?: PlayerCue): void {
    player.open(d, { ...cue, autoplay: true });
    markPlaying(d.demoId);
    if (chrome && isMobile()) root.dataset.sidebar = "closed";
  }
  function isMobile(): boolean {
    const win = root.ownerDocument.defaultView;
    return typeof win?.matchMedia === "function"
      ? win.matchMedia("(max-width: 760px)").matches
      : false;
  }

  /* ---------- shell scaffold ---------- */

  let side: HTMLElement | null = null;
  let libList: HTMLElement | null = null;
  let libGroupHead: HTMLElement | null = null;
  let libCount: HTMLElement | null = null;
  let topbarTitleSub: HTMLElement | null = null;
  let topbarBack: HTMLButtonElement | null = null;

  if (chrome) {
    side = el("aside", "daymo-help-side");
    side.innerHTML =
      `<div class="daymo-help-side-top"><div class="daymo-help-brand"><span class="daymo-help-brand-tx"><span class="daymo-help-nm"></span><span class="daymo-help-brand-sub"></span></span></div><button type="button" class="daymo-help-icon-btn daymo-help-side-collapse">${ICONS.panel}</button></div><button type="button" class="daymo-help-new">${ICONS.plus}<span></span></button><div class="daymo-help-side-search">${ICONS.search}<input class="daymo-help-lib-search" type="text" /></div><div class="daymo-help-side-scroll"><div class="daymo-help-side-grp-h" hidden><span class="daymo-help-side-grp-tx"></span><span class="daymo-help-side-count"></span></div><div class="daymo-help-lib"></div></div><div class="daymo-help-side-foot"><span class="daymo-help-badge">${ICONS.spark}</span><span class="daymo-help-built-tx"></span><b>Daymo</b></div>`;

    const brand = sq(side, ".daymo-help-brand");
    brand.insertBefore(brandMark("daymo-help-mk", ICONS.logo), brand.firstChild);
    const nm = sq(side, ".daymo-help-nm");
    if (opts.name) {
      nm.textContent = `${opts.name} `;
      const suffix = doc.createElement("span");
      suffix.textContent = strings.brandSuffix;
      nm.appendChild(suffix);
    } else {
      nm.textContent = strings.brandSuffix;
    }
    sq(side, ".daymo-help-brand-sub").textContent = strings.brandTagline;
    sq(side, ".daymo-help-new span").textContent = strings.newQuestion;
    sq<HTMLInputElement>(side, ".daymo-help-lib-search").placeholder = strings.searchGuides;
    sq(side, ".daymo-help-side-grp-tx").textContent = strings.libraryHeading;
    sq(side, ".daymo-help-built-tx").textContent = `${strings.builtWith} `;
    sq(side, ".daymo-help-side-collapse").setAttribute("aria-label", strings.closeLabel);

    libList = sq(side, ".daymo-help-lib");
    libGroupHead = sq(side, ".daymo-help-side-grp-h");
    libCount = sq(side, ".daymo-help-side-count");

    const toggle = (): void => {
      root.dataset.sidebar = root.dataset.sidebar === "open" ? "closed" : "open";
    };
    sq(side, ".daymo-help-side-collapse").addEventListener("click", toggle);
    sq(side, ".daymo-help-new").addEventListener("click", () => {
      resetChat();
      if (isMobile()) root.dataset.sidebar = "closed";
    });
    sq<HTMLInputElement>(side, ".daymo-help-lib-search").addEventListener("input", (e) => {
      const term = (e.target as HTMLInputElement).value.toLowerCase();
      libList!.querySelectorAll<HTMLElement>(".daymo-help-lib-row").forEach((rowEl) => {
        const d = demosById.get(rowEl.dataset.demoId ?? "");
        const hit =
          !term ||
          !d ||
          d.title.toLowerCase().includes(term) ||
          d.description.toLowerCase().includes(term);
        rowEl.style.display = hit ? "" : "none";
      });
    });
  }

  const main = el("div", "daymo-help-main");

  if (chrome) {
    const topbar = el("header", "daymo-help-topbar");
    topbar.innerHTML =
      `<button type="button" class="daymo-help-icon-btn daymo-help-topbar-menu">${ICONS.menu}</button><button type="button" class="daymo-help-topbar-back" hidden>${ICONS.back}<span></span></button><div class="daymo-help-topbar-title"><span class="daymo-help-topbar-title-tx"></span><span class="daymo-help-topbar-title-sub"></span></div><span class="daymo-help-topbar-sp"></span><a class="daymo-help-contact" hidden>${ICONS.contact}<span></span></a>`;
    sq(topbar, ".daymo-help-topbar-title-tx").textContent = strings.topbarTitle;
    topbarTitleSub = sq(topbar, ".daymo-help-topbar-title-sub");
    topbarTitleSub.textContent = ` · ${strings.topbarWelcome}`;
    topbarBack = sq<HTMLButtonElement>(topbar, ".daymo-help-topbar-back");
    sq(topbarBack, "span").textContent = strings.backToGuides;
    topbarBack.addEventListener("click", () => resetChat());
    sq(topbar, ".daymo-help-topbar-menu").setAttribute("aria-label", strings.newQuestion);
    sq(topbar, ".daymo-help-topbar-menu").addEventListener("click", () => {
      root.dataset.sidebar = root.dataset.sidebar === "open" ? "closed" : "open";
    });
    if (opts.contactHref) {
      const contact = sq<HTMLAnchorElement>(topbar, ".daymo-help-contact");
      contact.hidden = false;
      contact.href = opts.contactHref;
      sq(contact, "span").textContent = strings.contactLabel;
    }
    main.appendChild(topbar);
  }

  const scroll = el("div", "daymo-help-scroll");
  const content = el("div", "daymo-help-content");
  scroll.appendChild(content);
  main.appendChild(scroll);

  // topbar scroll shadow (scoped element listener)
  scroll.addEventListener("scroll", () => {
    const top = main.querySelector(".daymo-help-topbar");
    top?.classList.toggle("scrolled", scroll.scrollTop > 8);
  });

  // bottom composer (conversation mode)
  const composerDock = el("div", "daymo-help-composer-dock");
  composerDock.hidden = true;
  composerDock.innerHTML =
    `<div class="daymo-help-composer"><textarea class="daymo-help-composer-input" rows="1"></textarea><button type="button" class="daymo-help-composer-send">${ICONS.send}</button></div><div class="daymo-help-composer-note"></div>`;
  const composerInput = sq<HTMLTextAreaElement>(composerDock, ".daymo-help-composer-input");
  composerInput.placeholder = strings.composerPlaceholder;
  composerInput.setAttribute("aria-label", strings.composerPlaceholder);
  sq(composerDock, ".daymo-help-composer-send").setAttribute("aria-label", strings.askButton);
  sq(composerDock, ".daymo-help-composer-note").textContent = strings.composerNote;
  autogrow(composerInput);
  const composerSubmit = (): void => {
    const v = composerInput.value.trim();
    if (!v) return;
    composerInput.value = "";
    composerInput.style.height = "auto";
    ask(v);
  };
  sq(composerDock, ".daymo-help-composer-send").addEventListener("click", composerSubmit);
  composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composerSubmit();
    }
  });
  main.appendChild(composerDock);

  /* ---------- sidebar library ---------- */

  function libRow(d: ManifestDemo): HTMLElement {
    const r = el("button", "daymo-help-lib-row");
    (r as HTMLButtonElement).type = "button";
    r.dataset.demoId = d.demoId;
    r.innerHTML =
      `<span class="daymo-help-lib-thumb"><img alt="" /></span><span class="daymo-help-lib-meta"><span class="daymo-help-lib-title"></span><span class="daymo-help-lib-sub">${ICONS.play}<span></span></span></span>`;
    sq<HTMLImageElement>(r, "img").src = d.posterUrl;
    sq(r, ".daymo-help-lib-title").textContent = d.title;
    sq(r, ".daymo-help-lib-sub span").textContent = durSteps(d);
    r.addEventListener("click", () => openPlayer(d));
    return r;
  }
  function markPlaying(id: string | null): void {
    libList?.querySelectorAll<HTMLElement>(".daymo-help-lib-row").forEach((r) => {
      r.classList.toggle("playing", r.dataset.demoId === id);
    });
  }
  function buildLibrary(): void {
    if (!libList || !libGroupHead || !libCount) return;
    libList.textContent = "";
    libGroupHead.hidden = demos.length === 0;
    libCount.textContent = String(demos.length);
    for (const d of demos) libList.appendChild(libRow(d));
  }

  /* ---------- home landing ---------- */

  function autogrow(ta: HTMLTextAreaElement): void {
    const fit = (): void => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
    };
    ta.addEventListener("input", fit);
  }
  function wireAsk(askbar: HTMLElement): HTMLTextAreaElement {
    const ta = sq<HTMLTextAreaElement>(askbar, "textarea");
    autogrow(ta);
    const submit = (): void => {
      const v = ta.value.trim();
      if (!v) return;
      ta.value = "";
      ta.style.height = "auto";
      ask(v);
    };
    sq(askbar, ".daymo-help-send").addEventListener("click", submit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    return ta;
  }

  // The home hero is a poster, not an inline <video>: clicking the stage (or the
  // "Watch walkthrough" cue) opens the full theater player and plays. The rail
  // below swaps which walkthrough is featured.
  function inlineHomePlayer(): HTMLElement {
    const wrap = el("div", "daymo-help-home-player");
    wrap.innerHTML =
      `<button type="button" class="daymo-help-hp-stage"><span class="daymo-help-hp-poster"><img alt="" /></span><span class="daymo-help-hp-overlay">${ICONS.play}</span><span class="daymo-help-hp-bar"><span class="daymo-help-hp-bar-tx"><span class="daymo-help-hp-kicker"></span><span class="daymo-help-hp-title"></span></span><span class="daymo-help-hp-watch">${ICONS.play}<span></span></span></span></button><div class="daymo-help-hp-rail"></div>`;

    const stage = sq<HTMLButtonElement>(wrap, ".daymo-help-hp-stage");
    const posterImg = sq<HTMLImageElement>(wrap, ".daymo-help-hp-poster img");
    const kicker = sq(wrap, ".daymo-help-hp-kicker");
    const titleEl = sq(wrap, ".daymo-help-hp-title");
    const rail = sq(wrap, ".daymo-help-hp-rail");
    sq(wrap, ".daymo-help-hp-watch span").textContent = strings.watchLabel;
    let cur = demos[0];

    const load = (d: ManifestDemo): void => {
      cur = d;
      posterImg.src = d.posterUrl;
      kicker.textContent = strings.featuredLabel;
      titleEl.textContent = d.title;
      wrap.querySelectorAll<HTMLElement>(".daymo-help-hp-chip").forEach((c) =>
        c.classList.toggle("on", c.dataset.demoId === d.demoId),
      );
    };

    stage.addEventListener("click", () => openPlayer(cur));

    for (const d of demos) {
      const c = el("button", "daymo-help-hp-chip");
      (c as HTMLButtonElement).type = "button";
      c.dataset.demoId = d.demoId;
      c.innerHTML =
        `<span class="daymo-help-hp-chip-thumb"><img alt="" /><span class="daymo-help-hp-chip-dur"></span></span><span class="daymo-help-hp-chip-title"></span>`;
      sq<HTMLImageElement>(c, "img").src = d.posterUrl;
      sq(c, ".daymo-help-hp-chip-dur").textContent = formatDuration(d.durationMs);
      sq(c, ".daymo-help-hp-chip-title").textContent = d.title;
      c.addEventListener("click", () => load(d));
      rail.appendChild(c);
    }

    load(demos[0]);
    return wrap;
  }

  function renderHome(): void {
    content.textContent = "";
    const home = el("div", "daymo-help-home");

    home.appendChild(
      el(
        "div",
        "daymo-help-home-greeting",
        `<div class="daymo-help-eyebrow"><span class="daymo-help-pip"></span><span class="daymo-help-eyebrow-tx"></span></div><h1 class="daymo-help-h1"></h1><p class="daymo-help-lede"></p>`,
      ),
    );
    sq(home, ".daymo-help-eyebrow-tx").textContent = strings.eyebrow;
    sq(home, ".daymo-help-h1").textContent = strings.heroTitle;
    sq(home, ".daymo-help-lede").textContent = strings.lede;

    if (demos.length > 0) home.appendChild(inlineHomePlayer());

    const askbar = el(
      "div",
      "daymo-help-askbar daymo-help-home-ask",
      `<span class="daymo-help-lead">${ICONS.spark}</span><textarea class="daymo-help-input" rows="1"></textarea><button type="button" class="daymo-help-send">${ICONS.arrow}</button>`,
    );
    sq<HTMLTextAreaElement>(askbar, ".daymo-help-input").placeholder = strings.askPlaceholder;
    sq<HTMLTextAreaElement>(askbar, ".daymo-help-input").setAttribute("aria-label", strings.askPlaceholder);
    sq(askbar, ".daymo-help-send").setAttribute("aria-label", strings.askButton);
    home.appendChild(askbar);
    wireAsk(askbar);

    const suggested = opts.suggestedQuestions ?? [];
    if (suggested.length > 0) {
      const sug = el("div", "daymo-help-suggest");
      sug.appendChild(el("div", "daymo-help-suggest-lbl"));
      sq(sug, ".daymo-help-suggest-lbl").textContent = strings.popularLabel;
      const chips = el("div", "daymo-help-suggest-chips");
      for (const s of suggested) {
        const c = chip(s, () => ask(s));
        c.insertAdjacentHTML("afterbegin", ICONS.search);
        chips.appendChild(c);
      }
      sug.appendChild(chips);
      home.appendChild(sug);
    }

    content.appendChild(home);
  }

  /* ---------- conversation thread ---------- */

  let thread: HTMLElement | null = null;

  function switchToConversation(): void {
    content.textContent = "";
    thread = el("div", "daymo-help-thread");
    thread.setAttribute("aria-live", "polite");
    content.appendChild(thread);
    composerDock.hidden = false;
    if (topbarTitleSub) topbarTitleSub.textContent = ` · ${strings.topbarConversation}`;
    if (topbarBack) topbarBack.hidden = false;
  }
  function resetChat(): void {
    history.length = 0;
    messageCount = 0;
    player.close();
    markPlaying(null);
    composerDock.hidden = true;
    if (topbarTitleSub) topbarTitleSub.textContent = ` · ${strings.topbarWelcome}`;
    if (topbarBack) topbarBack.hidden = true;
    thread = null;
    renderHome();
  }

  function ask(message: string): void {
    message = message.trim();
    if (!message) return;
    if (messageCount === 0) switchToConversation();
    messageCount += 1;

    const qa = el("div", "daymo-help-qa");
    qa.innerHTML =
      `<div class="daymo-help-q-row"><div class="daymo-help-q-bubble"></div></div><div class="daymo-help-a-row"><div class="daymo-help-a-body"><div class="daymo-help-a-name"><span class="daymo-help-a-nm"></span><span class="daymo-help-a-tag"></span></div><div class="daymo-help-a-text"><span class="daymo-help-typing"><i></i><i></i><i></i></span></div></div></div>`;
    sq(qa, ".daymo-help-q-bubble").textContent = message;
    const aRow = sq(qa, ".daymo-help-a-row");
    aRow.insertBefore(brandMark("daymo-help-a-av", ICONS.spark), aRow.firstChild);
    sq(qa, ".daymo-help-a-nm").textContent = strings.assistantName;
    sq(qa, ".daymo-help-a-tag").textContent = strings.assistantTag;
    thread!.appendChild(qa);
    scrollToStart(qa);

    const body = sq(qa, ".daymo-help-a-text");

    // Serialize turns: dispatch this request only after the previous turn has
    // settled, so the history we send always reflects the prior answer.
    pending = pending
      .catch(() => {})
      .then(() => {
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
            const err = el("p", "daymo-help-error");
            err.textContent = strings.errorText;
            body.appendChild(err);
          });
      });
  }

  function renderResponse(body: HTMLElement, resp: ChatResponse): void {
    body.textContent = ""; // removes the typing indicator
    const qa = body.closest<HTMLElement>(".daymo-help-qa");
    if (resp.kind === "no_match") {
      const p = el("p", "daymo-help-a-p");
      p.textContent = resp.text;
      body.appendChild(p);
      const suggestions =
        resp.suggestions && resp.suggestions.length > 0
          ? resp.suggestions
          : (opts.suggestedQuestions ?? []);
      if (suggestions.length > 0) {
        const row = el("div", "daymo-help-a-chips");
        for (const s of suggestions) row.appendChild(chip(s, () => ask(s)));
        body.appendChild(row);
      }
      // a playlist of whatever guides we do have
      if (demos.length > 0) body.appendChild(relatedPlaylist(demos.slice(0, 8)));
      body.appendChild(actionRow(resp.text));
      if (qa) scrollToStart(qa);
      history.push({ role: "assistant", content: resp.text });
      return;
    }

    const summary: string[] = [];
    const cited = new Set<string>();
    const cards = groupVideoParts(resp.parts);
    resp.parts.forEach((part, i) => {
      if (part.kind === "text") {
        const p = el("p", "daymo-help-a-p");
        p.textContent = part.text;
        body.appendChild(p);
        summary.push(part.text);
        return;
      }
      const ref = cards.get(i);
      if (!ref) return; // same-demo follow-up reference — collapsed into the first card
      body.appendChild(renderDemoCard(ref));
      cited.add(ref.demoId);
    });
    const related = demos.filter((d) => !cited.has(d.demoId)).slice(0, 8);
    if (related.length > 0) body.appendChild(relatedPlaylist(related));
    const followups = opts.suggestedQuestions ?? [];
    if (followups.length > 0) body.appendChild(followupRow(followups));
    body.appendChild(actionRow(summary.join(" ")));
    if (qa) scrollToStart(qa);
    history.push({ role: "assistant", content: summary.join(" ") });
  }

  function renderDemoCard(ref: DemoCardRef): HTMLElement {
    const demo = demosById.get(ref.demoId);
    if (!demo) {
      // Manifest not loaded (or unknown demo): open-ended media-fragment fallback.
      const wrap = el("div", "daymo-help-clip-fallback");
      const video = doc.createElement("video");
      video.controls = true;
      video.src = `${ref.mp4Url}#t=${ref.startMs / 1000}`;
      wrap.appendChild(video);
      const caption = ref.steps[0]?.caption;
      if (caption) {
        const cap = doc.createElement("small");
        cap.textContent = caption;
        wrap.appendChild(cap);
      }
      return wrap;
    }
    const clip = el("button", "daymo-help-clip");
    (clip as HTMLButtonElement).type = "button";
    clip.innerHTML =
      `<span class="daymo-help-clip-poster"><img alt="" /><span class="daymo-help-clip-play">${ICONS.play}</span><span class="daymo-help-clip-dur"></span></span><span class="daymo-help-clip-ci"><span class="daymo-help-clip-kicker"><span class="daymo-help-dot"></span><span></span></span><span class="daymo-help-clip-cap"></span><span class="daymo-help-clip-steps"></span><span class="daymo-help-clip-cta">${ICONS.play}<span></span></span></span>`;
    sq<HTMLImageElement>(clip, "img").src = demo.posterUrl;
    sq(clip, ".daymo-help-clip-dur").textContent = formatDuration(demo.durationMs);
    const stepIx = demo.steps.findIndex((s) => s.stepId === ref.steps[0]?.stepId);
    const stepPos = stepIx >= 0
      ? stepIx + 1
      : Math.max(1, demo.steps.filter((s) => s.startMs <= ref.startMs).length);
    sq(clip, ".daymo-help-clip-kicker span:last-child").textContent =
      `${strings.fullDemoLabel} · ${strings.startsAtStep} ${stepPos}/${demo.steps.length}`;
    sq(clip, ".daymo-help-clip-cap").textContent = demo.title;
    const stepsEl = sq(clip, ".daymo-help-clip-steps");
    for (const s of ref.steps) {
      const line = el("span", "daymo-help-clip-step-line");
      line.textContent = `${formatDuration(s.startMs)} · ${s.caption}`;
      stepsEl.appendChild(line);
    }
    sq(clip, ".daymo-help-clip-cta span").textContent = strings.playLabel;
    clip.addEventListener("click", () =>
      openPlayer(demo, { startMs: ref.startMs, referencedStepIds: ref.steps.map((s) => s.stepId) }),
    );
    return clip;
  }

  function relatedPlaylist(list: ManifestDemo[]): HTMLElement {
    const wrap = el("div", "daymo-help-related");
    wrap.appendChild(
      el("div", "daymo-help-related-h", `${ICONS.layers}<span></span>`),
    );
    sq(wrap, ".daymo-help-related-h span").textContent = strings.relatedHeading;
    const scrollRow = el("div", "daymo-help-related-scroll");
    for (const d of list) {
      const c = el("button", "daymo-help-rcard");
      (c as HTMLButtonElement).type = "button";
      c.innerHTML =
        `<span class="daymo-help-rposter"><img alt="" /><span class="daymo-help-rposter-play">${ICONS.play}</span><span class="daymo-help-rposter-dur"></span></span><span class="daymo-help-rmeta"><span class="daymo-help-rmeta-title"></span><span class="daymo-help-rmeta-sub"></span></span>`;
      sq<HTMLImageElement>(c, "img").src = d.posterUrl;
      sq(c, ".daymo-help-rposter-dur").textContent = formatDuration(d.durationMs);
      sq(c, ".daymo-help-rmeta-title").textContent = d.title;
      sq(c, ".daymo-help-rmeta-sub").textContent = `${d.steps.length} ${strings.stepsSuffix}`;
      c.addEventListener("click", () => openPlayer(d));
      scrollRow.appendChild(c);
    }
    wrap.appendChild(scrollRow);
    return wrap;
  }

  function followupRow(qs: string[]): HTMLElement {
    const wrap = el("div", "daymo-help-followups");
    for (const qstr of qs) {
      const c = el("button", "daymo-help-fchip", `${ICONS.chat}<span></span>`);
      (c as HTMLButtonElement).type = "button";
      sq(c, "span").textContent = qstr;
      c.addEventListener("click", () => ask(qstr));
      wrap.appendChild(c);
    }
    return wrap;
  }

  function actionRow(copyText: string): HTMLElement {
    const r = el("div", "daymo-help-a-actions");
    const up = el("button", "daymo-help-act-btn", ICONS.up);
    (up as HTMLButtonElement).type = "button";
    up.setAttribute("aria-label", strings.helpfulLabel);
    const down = el("button", "daymo-help-act-btn", ICONS.down);
    (down as HTMLButtonElement).type = "button";
    down.setAttribute("aria-label", strings.notHelpfulLabel);
    up.addEventListener("click", () => {
      up.classList.toggle("on");
      down.classList.remove("on");
    });
    down.addEventListener("click", () => {
      down.classList.toggle("on");
      up.classList.remove("on");
    });
    const cp = el("button", "daymo-help-act-btn", ICONS.copy);
    (cp as HTMLButtonElement).type = "button";
    cp.setAttribute("aria-label", strings.copyLabel);
    cp.addEventListener("click", () => {
      void root.ownerDocument.defaultView?.navigator?.clipboard?.writeText?.(copyText);
      cp.classList.add("on");
    });
    r.append(up, down, el("span", "daymo-help-act-sep"), cp);
    return r;
  }

  // Bring the TOP of a Q&A block to the top of the scroll area, so each new
  // answer is read from the beginning (not scrolled to its end). A tail spacer
  // guarantees there's room below for the latest block to reach the top even
  // when the answer is short.
  function scrollToStart(node: HTMLElement): void {
    if (!thread) return;
    let tail = thread.querySelector<HTMLElement>(":scope > .daymo-help-thread-tail");
    if (!tail) tail = el("div", "daymo-help-thread-tail");
    thread.appendChild(tail); // keep it last
    const apply = (): void => {
      const need = Math.max(0, scroll.clientHeight - node.getBoundingClientRect().height - 40);
      tail!.style.height = `${need}px`;
      const target =
        scroll.scrollTop +
        (node.getBoundingClientRect().top - scroll.getBoundingClientRect().top) -
        18;
      const prev = scroll.style.scrollBehavior;
      scroll.style.scrollBehavior = "auto";
      scroll.scrollTop = Math.max(0, target);
      scroll.style.scrollBehavior = prev;
    };
    // Run once layout has settled, then again to defeat scroll-anchoring.
    setTimeout(apply, 40);
    setTimeout(apply, 160);
  }

  /* ---------- manifest load ---------- */

  void fetchFn(opts.manifestUrl)
    .then((r) => r.json() as Promise<HelpManifest>)
    .then((manifest) => {
      if (cancelled) return;
      demos = manifest.demos;
      demosById.clear();
      for (const d of demos) demosById.set(d.demoId, d);
      buildLibrary();
      if (messageCount === 0) renderHome(); // refresh home with the inline player + rail
    })
    .catch(() => {
      /* library + inline player stay empty on failure */
    });

  /* ---------- assemble ---------- */

  if (side) root.appendChild(side);
  root.appendChild(main);
  if (chrome) {
    const scrim = el("div", "daymo-help-scrim");
    scrim.addEventListener("click", () => {
      root.dataset.sidebar = "closed";
    });
    root.appendChild(scrim);
  }
  renderHome();
  // On mobile the sidebar is a fixed overlay drawer — start it closed so it
  // doesn't cover the content on first load.
  if (chrome && isMobile()) root.dataset.sidebar = "closed";
  container.appendChild(root);

  // Crossing into mobile (e.g. rotating to portrait, or shrinking the window)
  // turns the inline sidebar into a fixed drawer — if it was open it would now
  // cover the content, so force it closed on that transition.
  const mq = doc.defaultView?.matchMedia?.("(max-width: 760px)");
  const onViewport = (e: MediaQueryListEvent): void => {
    if (chrome && e.matches) root.dataset.sidebar = "closed";
  };
  mq?.addEventListener?.("change", onViewport);

  return () => {
    cancelled = true;
    mq?.removeEventListener?.("change", onViewport);
    player.destroy();
    root.remove();
  };
}
