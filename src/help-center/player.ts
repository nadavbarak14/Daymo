import type { ManifestDemo } from "../publish/types.js";
import type { HelpCenterStrings } from "./strings.js";
import { formatDuration } from "./gallery-model.js";
import { ICONS } from "./icons.js";

export interface PlayerCue {
  startMs?: number;
  /** Steps cited by a chat answer — rendered with a persistent "referenced"
   *  state in the timeline (distinct from the playhead-following "active"). */
  referencedStepIds?: string[];
  autoplay?: boolean;
}

export interface PlayerOptions {
  /** Returns every demo so the player can show an "Up next" queue (the current
   *  demo is filtered out). Re-read on each open so it tracks the loaded
   *  manifest. Omit for no queue. */
  queue?: () => ManifestDemo[];
}

export interface Player {
  open(demo: ManifestDemo, cue?: PlayerCue): void;
  close(): void;
  /** Close + remove the body-appended modal. Called by the mount's unmount. */
  destroy(): void;
  /** The modal element (body-appended); the mount mirrors --daymo-accent here. */
  readonly el: HTMLElement;
}

/** Body-appended theater modal player. The modal lives outside the .daymo-help
 *  root (escapes host stacking contexts), so the stylesheet declares tokens on
 *  `.daymo-help-modal` too, and the mount mirrors brandColor onto `el`.
 *
 *  Layout: a centered card with the video on the left and an aside on the right
 *  carrying the title, a clickable step timeline, and an "Up next" playlist. */
export function createPlayer(
  doc: Document,
  strings: HelpCenterStrings,
  opts: PlayerOptions = {},
): Player {
  const modal = doc.createElement("div");
  modal.className = "daymo-help-modal";
  // Single template literal on purpose: concatenating template-literal operands
  // with "+" trips a constant-folding bug in SWC/Turbopack minification (Next
  // 16) that silently DROPS operands — see the note in mount.ts. Same for every
  // innerHTML below.
  modal.innerHTML = `<div class="daymo-help-player" role="dialog" aria-modal="true"><button type="button" class="daymo-help-player-close">${ICONS.close}</button><div class="daymo-help-player-main"><div class="daymo-help-stage"><video controls playsinline preload="metadata"></video></div><aside class="daymo-help-player-aside"><div class="daymo-help-player-head"><div class="daymo-help-player-kicker"><span class="daymo-help-pip"></span><span class="daymo-help-player-kicker-tx"></span></div><h3 class="daymo-help-player-title"></h3><p class="daymo-help-player-desc"></p></div><div class="daymo-help-player-sec"><div class="daymo-help-steps-h"><span class="daymo-help-steps-h-tx"></span><span class="daymo-help-steps-meta"></span></div><div class="daymo-help-steps"><div class="daymo-help-steps-list"></div></div></div><div class="daymo-help-player-sec daymo-help-queue-sec" hidden></div></aside></div></div>`;

  const q = <T extends HTMLElement = HTMLElement>(sel: string): T =>
    modal.querySelector(sel) as T;

  const card = q(".daymo-help-player");
  const titleEl = q(".daymo-help-player-title");
  const descEl = q(".daymo-help-player-desc");
  const closeBtn = q<HTMLButtonElement>(".daymo-help-player-close");
  const video = q<HTMLVideoElement>("video");
  const stepsList = q(".daymo-help-steps-list");
  const stepsMeta = q(".daymo-help-steps-meta");
  const queueSec = q(".daymo-help-queue-sec");

  q(".daymo-help-player-kicker-tx").textContent = strings.nowPlaying;
  q(".daymo-help-steps-h-tx").textContent = strings.stepsHeading;
  closeBtn.setAttribute("aria-label", strings.closeLabel);

  let demo: ManifestDemo | null = null;
  let opener: Element | null = null;
  let scrollLocked = false;
  let prevOverflow = "";
  let pendingSeek: (() => void) | null = null;
  let autoplay = true;
  // "Up next" can get long; default it folded away and let users open it.
  // Remembered across re-opens.
  let queueCollapsed = true;

  function clearPendingSeek(): void {
    if (pendingSeek) {
      video.removeEventListener("loadedmetadata", pendingSeek);
      pendingSeek = null;
    }
  }

  video.addEventListener("timeupdate", () => {
    const ms = video.currentTime * 1000;
    highlightStep(ms);
  });
  // Autoplay-to-next: when a clip plays to its natural end and autoplay is on,
  // advance to the first queued demo.
  video.addEventListener("ended", () => {
    if (!autoplay) return;
    const next = queueDemos()[0];
    if (next) open(next, { autoplay: true });
  });

  function queueDemos(): ManifestDemo[] {
    const all = opts.queue?.() ?? [];
    return all.filter((d) => d.demoId !== demo?.demoId);
  }

  function highlightStep(ms: number): void {
    if (!demo) return;
    let active = 0;
    demo.steps.forEach((s, i) => {
      if (ms >= s.startMs) active = i;
    });
    stepsList.querySelectorAll(".daymo-help-step").forEach((el, i) => {
      el.classList.toggle("active", i === active);
    });
  }

  /** Seek once metadata is available (setting currentTime before
   *  loadedmetadata is unreliable). */
  function seekWhenReady(startMs: number): void {
    clearPendingSeek();
    const apply = () => {
      pendingSeek = null;
      video.currentTime = startMs / 1000;
    };
    if (video.readyState >= 1) apply();
    else {
      pendingSeek = apply;
      video.addEventListener("loadedmetadata", apply, { once: true });
    }
  }

  function buildSteps(d: ManifestDemo, referenced: Set<string>): void {
    stepsList.textContent = "";
    for (const s of d.steps) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "daymo-help-step";
      if (referenced.has(s.stepId)) b.classList.add("referenced");
      const ix = doc.createElement("span");
      ix.className = "daymo-help-step-ix";
      ix.textContent = formatDuration(s.startMs);
      const lb = doc.createElement("span");
      lb.className = "daymo-help-step-lb";
      lb.textContent = s.label;
      b.append(ix, lb);
      b.addEventListener("click", () => {
        seekWhenReady(s.startMs);
        void Promise.resolve(video.play()).catch(() => undefined);
      });
      stepsList.appendChild(b);
    }
    stepsMeta.textContent = `${formatDuration(d.durationMs)} · ${d.steps.length} ${strings.stepsSuffix}`;
  }

  function buildQueue(): void {
    const items = queueDemos();
    queueSec.textContent = "";
    queueSec.hidden = items.length === 0;
    if (items.length === 0) return;

    const head = doc.createElement("div");
    head.className = "daymo-help-queue-h";
    // The heading doubles as a collapse toggle for the (potentially long) list.
    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = "daymo-help-queue-toggle";
    toggle.setAttribute("aria-label", strings.upNext);
    toggle.innerHTML =
      `<span class="daymo-help-queue-caret">${ICONS.chevron}</span><span class="daymo-help-queue-h-tx"></span>`;
    (toggle.querySelector(".daymo-help-queue-h-tx") as HTMLElement).textContent = strings.upNext;
    const autoBtn = doc.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "daymo-help-autoplay";
    autoBtn.setAttribute("aria-pressed", String(autoplay));
    autoBtn.classList.toggle("off", !autoplay);
    autoBtn.innerHTML =
      `<span class="daymo-help-autoplay-tx"></span><span class="daymo-help-switch"></span>`;
    (autoBtn.querySelector(".daymo-help-autoplay-tx") as HTMLElement).textContent = strings.autoplayLabel;
    autoBtn.addEventListener("click", () => {
      autoplay = !autoplay;
      autoBtn.setAttribute("aria-pressed", String(autoplay));
      autoBtn.classList.toggle("off", !autoplay);
    });
    head.append(toggle, autoBtn);
    queueSec.appendChild(head);

    const list = doc.createElement("div");
    list.className = "daymo-help-queue";
    queueSec.appendChild(list);

    const applyCollapsed = (): void => {
      queueSec.classList.toggle("collapsed", queueCollapsed);
      list.hidden = queueCollapsed;
      toggle.setAttribute("aria-expanded", String(!queueCollapsed));
    };
    toggle.addEventListener("click", () => {
      queueCollapsed = !queueCollapsed;
      applyCollapsed();
    });
    applyCollapsed();

    for (const d of items) {
      const it = doc.createElement("button");
      it.type = "button";
      it.className = "daymo-help-qitem";
      it.innerHTML = `<span class="daymo-help-qitem-thumb"><img alt="" /><span class="daymo-help-qitem-dur"></span></span><span class="daymo-help-qitem-meta"><span class="daymo-help-qitem-title"></span><span class="daymo-help-qitem-sub"></span></span>`;
      (it.querySelector("img") as HTMLImageElement).src = d.posterUrl;
      (it.querySelector(".daymo-help-qitem-dur") as HTMLElement).textContent = formatDuration(d.durationMs);
      (it.querySelector(".daymo-help-qitem-title") as HTMLElement).textContent = d.title;
      (it.querySelector(".daymo-help-qitem-sub") as HTMLElement).textContent =
        `${d.steps.length} ${strings.stepsSuffix}`;
      it.addEventListener("click", () => open(d, { autoplay: true }));
      list.appendChild(it);
    }
  }

  function open(d: ManifestDemo, cue?: PlayerCue): void {
    const wasOpen = modal.classList.contains("open");
    clearPendingSeek();
    demo = d;
    titleEl.textContent = d.title;
    descEl.textContent = d.description;
    video.src = d.videoUrl;
    video.poster = d.posterUrl;

    buildSteps(d, new Set(cue?.referencedStepIds ?? []));
    buildQueue();

    // Setting video.src above resets the playhead to 0, so only an explicit
    // cue needs a seek.
    if (cue?.startMs != null && cue.startMs > 0) seekWhenReady(cue.startMs);
    highlightStep(cue?.startMs ?? 0);

    if (!wasOpen) {
      opener = doc.activeElement;
      modal.classList.add("open");
      if (!scrollLocked) {
        prevOverflow = doc.body.style.overflow;
        scrollLocked = true;
      }
      doc.body.style.overflow = "hidden";
      closeBtn.focus();
    }
    if (cue?.autoplay) void Promise.resolve(video.play()).catch(() => undefined);
  }

  function close(): void {
    if (!modal.classList.contains("open")) return;
    video.pause();
    clearPendingSeek();
    modal.classList.remove("open");
    if (scrollLocked) {
      doc.body.style.overflow = prevOverflow;
      scrollLocked = false;
    }
    if (opener instanceof HTMLElement) opener.focus();
    opener = null;
  }

  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = modal.querySelectorAll<HTMLElement>("button, video, [href]");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && doc.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && doc.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  // clicks inside the card never bubble to the backdrop-close handler above
  card.addEventListener("click", (e) => e.stopPropagation());

  doc.body.appendChild(modal);

  return {
    open,
    close,
    destroy(): void {
      close();
      modal.remove();
    },
    el: modal,
  };
}
