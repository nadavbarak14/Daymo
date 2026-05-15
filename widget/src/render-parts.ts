import type { Part, VideoPart } from "./types.js";

export function renderParts(
  root: HTMLElement,
  parts: Part[],
  onPlay: (p: VideoPart) => void,
): void {
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

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function renderVideoPart(part: VideoPart, onPlay: (p: VideoPart) => void): HTMLElement {
  const card = document.createElement("button");
  card.className = "video-card";
  card.type = "button";
  card.setAttribute("aria-label", `Play clip: ${part.caption}`);

  const startSec = (part.startMs / 1000).toFixed(3).replace(/\.?0+$/, "");
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
