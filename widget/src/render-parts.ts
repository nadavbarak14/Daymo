import type { Part, VideoPart } from "./types.js";
import type { VideoSource } from "./manifest.js";

const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

export function renderParts(
  root: HTMLElement,
  parts: Part[],
  onPlay: (p: VideoPart) => void,
  resolveSource: (p: VideoPart) => VideoSource,
): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  for (const part of parts) {
    if (part.kind === "text") {
      const p = document.createElement("p");
      p.textContent = part.text;
      root.appendChild(p);
    } else {
      root.appendChild(renderVideoPart(part, onPlay, resolveSource(part)));
    }
  }
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function renderVideoPart(
  part: VideoPart,
  onPlay: (p: VideoPart) => void,
  source: VideoSource,
): HTMLElement {
  const card = document.createElement("button");
  card.className = "dw-video-card";
  card.type = "button";
  card.setAttribute("aria-label", `Play clip: ${part.caption}`);

  const thumb = document.createElement("span");
  thumb.className = "dw-thumb";
  if (source.posterUrl) {
    // Poster published next to the help-center videos (same manifest).
    thumb.style.backgroundImage = `url("${source.posterUrl}")`;
  } else {
    // No manifest: let the browser paint the clip's first frame.
    const startSec = (part.startMs / 1000).toFixed(3).replace(/\.?0+$/, "");
    const video = document.createElement("video");
    video.src = `${source.mp4Url}#t=${startSec}`;
    video.setAttribute("preload", "metadata");
    video.setAttribute("playsinline", "");
    video.muted = true;
    thumb.appendChild(video);
  }

  const play = document.createElement("span");
  play.className = "dw-play";
  play.innerHTML = PLAY_SVG;
  thumb.appendChild(play);

  const dur = document.createElement("span");
  dur.className = "dw-duration";
  dur.textContent = formatDuration(part.endMs - part.startMs);
  thumb.appendChild(dur);

  const foot = document.createElement("span");
  foot.className = "dw-card-foot";
  const dot = document.createElement("span");
  dot.className = "dw-tour-dot";
  const label = document.createElement("span");
  label.className = "dw-card-label";
  label.textContent = part.caption;
  foot.appendChild(dot);
  foot.appendChild(label);

  card.addEventListener("click", () => onPlay(part));

  card.appendChild(thumb);
  card.appendChild(foot);
  return card;
}
