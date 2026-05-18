"use client";
import { useEffect, useRef } from "react";
import type { VideoPart } from "../../../src/core/index-types.js";

export function VideoSegment({ part }: { part: VideoPart }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const el = node as HTMLVideoElement;
    function onTime() {
      if (el.currentTime * 1000 >= part.endMs) el.pause();
    }
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [part.endMs]);

  const src = `${part.mp4Url}#t=${part.startMs / 1000},${part.endMs / 1000}`;
  return (
    <figure style={{ margin: "0.5rem 0" }}>
      <video ref={ref} src={src} preload="metadata" playsInline controls style={{ width: "100%", borderRadius: "8px", background: "#000" }} />
      {part.caption && <figcaption style={{ fontSize: "0.875rem", color: "#666", marginTop: "0.25rem" }}>{part.caption}</figcaption>}
    </figure>
  );
}
