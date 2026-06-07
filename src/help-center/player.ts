import type { ManifestDemo } from "../publish/types.js";
import type { HelpCenterStrings } from "./strings.js";
import { formatDuration } from "./gallery-model.js";
import { ICONS } from "./icons.js";

export interface PlayerCue {
  startMs?: number;
  /** One-shot stop: playback pauses when it reaches this point. Cleared by
   *  any user seek or step click. */
  endMs?: number;
  autoplay?: boolean;
}

export interface Player {
  open(demo: ManifestDemo, cue?: PlayerCue): void;
  close(): void;
  /** Close + remove the body-appended modal. Called by the mount's unmount. */
  destroy(): void;
  /** The modal element (body-appended); the mount mirrors --daymo-accent here. */
  readonly el: HTMLElement;
}

/** Body-appended modal player. The modal lives outside the .daymo-help root
 *  (escapes host stacking contexts), so the stylesheet declares tokens on
 *  `.daymo-help-modal` too, and the mount mirrors brandColor onto `el`. */
export function createPlayer(doc: Document, strings: HelpCenterStrings): Player {
  const modal = doc.createElement("div");
  modal.className = "daymo-help-modal";
  modal.innerHTML =
    `<div class="daymo-help-player" role="dialog" aria-modal="true">` +
    `<div class="daymo-help-player-top">` +
    `<h3 class="daymo-help-player-title"></h3>` +
    `<button type="button" class="daymo-help-player-close">${ICONS.close}</button>` +
    `</div>` +
    `<div class="daymo-help-player-body">` +
    `<div class="daymo-help-stage"><video controls playsinline></video></div>` +
    `<div class="daymo-help-steps">` +
    `<div class="daymo-help-steps-h"></div>` +
    `<div class="daymo-help-steps-list"></div>` +
    `</div>` +
    `</div>` +
    `</div>`;

  const titleEl = modal.querySelector(".daymo-help-player-title") as HTMLElement;
  const closeBtn = modal.querySelector(".daymo-help-player-close") as HTMLButtonElement;
  const video = modal.querySelector("video") as HTMLVideoElement;
  const stepsList = modal.querySelector(".daymo-help-steps-list") as HTMLElement;
  (modal.querySelector(".daymo-help-steps-h") as HTMLElement).textContent = strings.stepsHeading;
  closeBtn.setAttribute("aria-label", strings.closeLabel);

  let demo: ManifestDemo | null = null;
  let clipEndMs: number | null = null;
  let programmaticSeek = false;
  let opener: Element | null = null;
  let scrollLocked = false;
  let prevOverflow = "";
  let pendingSeek: (() => void) | null = null;

  function clearPendingSeek(): void {
    if (pendingSeek) {
      video.removeEventListener("loadedmetadata", pendingSeek);
      pendingSeek = null;
    }
  }

  video.addEventListener("seeking", () => {
    if (programmaticSeek) programmaticSeek = false;
    else clipEndMs = null; // a user seek cancels the clip stop
  });
  video.addEventListener("timeupdate", () => {
    const ms = video.currentTime * 1000;
    if (clipEndMs !== null && ms >= clipEndMs) {
      clipEndMs = null;
      video.pause();
    }
    highlightStep(ms);
  });

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
   *  loadedmetadata is unreliable). `programmatic` marks the seek so the
   *  seeking handler doesn't treat it as a user seek. */
  function seekWhenReady(startMs: number, programmatic: boolean): void {
    clearPendingSeek();
    const apply = () => {
      pendingSeek = null;
      programmaticSeek = programmatic;
      video.currentTime = startMs / 1000;
    };
    if (video.readyState >= 1) apply();
    else {
      pendingSeek = apply;
      video.addEventListener("loadedmetadata", apply, { once: true });
    }
  }

  function open(d: ManifestDemo, cue?: PlayerCue): void {
    if (modal.classList.contains("open")) close();
    clearPendingSeek();
    demo = d;
    titleEl.textContent = d.title;
    video.src = d.videoUrl;
    video.poster = d.posterUrl;

    stepsList.textContent = "";
    for (const s of d.steps) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "daymo-help-step";
      const ix = doc.createElement("span");
      ix.className = "daymo-help-step-ix";
      ix.textContent = formatDuration(s.startMs);
      const lb = doc.createElement("span");
      lb.className = "daymo-help-step-lb";
      lb.textContent = s.label;
      b.append(ix, lb);
      b.addEventListener("click", () => {
        clipEndMs = null;
        seekWhenReady(s.startMs, false);
      });
      stepsList.appendChild(b);
    }

    clipEndMs = cue?.endMs ?? null;
    if (cue?.startMs != null && cue.startMs > 0) seekWhenReady(cue.startMs, true);
    highlightStep(cue?.startMs ?? 0);

    opener = doc.activeElement;
    modal.classList.add("open");
    if (!scrollLocked) {
      prevOverflow = doc.body.style.overflow;
      scrollLocked = true;
    }
    doc.body.style.overflow = "hidden";
    closeBtn.focus();
    if (cue?.autoplay) void Promise.resolve(video.play()).catch(() => undefined);
  }

  function close(): void {
    if (!modal.classList.contains("open")) return;
    video.pause();
    clearPendingSeek();
    clipEndMs = null;
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
