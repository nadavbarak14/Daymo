import type { Part } from "./types.js";
import type { VideoSource } from "./manifest.js";
import { groupVideoParts, type DemoCardRef } from "./answer-cards.js";

const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

export function renderParts(
  root: HTMLElement,
  parts: Part[],
  onPlay: (ref: DemoCardRef, source: VideoSource) => void,
  resolveSource: (ref: DemoCardRef) => VideoSource,
  strings: { playDemo: string },
): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  const cards = groupVideoParts(parts);
  parts.forEach((part, i) => {
    if (part.kind === "text") {
      const p = document.createElement("p");
      p.textContent = part.text;
      root.appendChild(p);
      return;
    }
    const ref = cards.get(i);
    if (!ref) return; // collapsed into this demo's first card
    root.appendChild(renderDemoCard(ref, onPlay, resolveSource(ref), strings));
  });
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function renderDemoCard(
  ref: DemoCardRef,
  onPlay: (ref: DemoCardRef, source: VideoSource) => void,
  source: VideoSource,
  strings: { playDemo: string },
): HTMLElement {
  const card = document.createElement("button");
  card.className = "dw-video-card";
  card.type = "button";
  card.setAttribute("aria-label", `${strings.playDemo} ${source.title ?? ref.steps[0]?.caption ?? ""}`);

  const thumb = document.createElement("span");
  thumb.className = "dw-thumb";
  if (source.posterUrl) {
    // Poster published next to the help-center videos (same manifest).
    thumb.style.backgroundImage = `url("${source.posterUrl}")`;
  } else {
    // No manifest: let the browser paint the clip's first frame.
    const startSec = (ref.startMs / 1000).toFixed(3).replace(/\.?0+$/, "");
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
  dur.textContent = formatDuration(source.durationMs ?? ref.endMs - ref.startMs);
  thumb.appendChild(dur);

  const foot = document.createElement("span");
  foot.className = "dw-card-foot";
  const dot = document.createElement("span");
  dot.className = "dw-tour-dot";
  const label = document.createElement("span");
  label.className = "dw-card-label";
  label.textContent = source.title ?? ref.steps[0]?.caption ?? "";
  foot.appendChild(dot);
  foot.appendChild(label);

  card.addEventListener("click", () => onPlay(ref, source));

  card.appendChild(thumb);
  card.appendChild(foot);
  return card;
}
