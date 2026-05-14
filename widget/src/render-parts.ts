import type { Part, VideoPart } from "./types.js";

export function renderParts(root: HTMLElement, parts: Part[]): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  for (const part of parts) {
    if (part.kind === "text") {
      const p = document.createElement("p");
      p.textContent = part.text;
      root.appendChild(p);
    } else {
      root.appendChild(renderVideoPart(part));
    }
  }
}

function renderVideoPart(part: VideoPart): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "video-wrap";

  const v = document.createElement("video");
  const startSec = (part.startMs / 1000).toFixed(3).replace(/\.?0+$/, "");
  const endSec = (part.endMs / 1000).toFixed(3).replace(/\.?0+$/, "");
  v.src = `${part.mp4Url}#t=${startSec},${endSec}`;
  v.setAttribute("preload", "metadata");
  v.setAttribute("playsinline", "");
  v.controls = true;

  v.addEventListener("timeupdate", () => {
    if (v.currentTime >= part.endMs / 1000) v.pause();
  });

  wrap.appendChild(v);
  const caption = document.createElement("small");
  caption.className = "caption";
  caption.textContent = part.caption;
  wrap.appendChild(caption);
  return wrap;
}
