import { useEffect, useRef, useState } from "react";
import { useUi } from "../store";
import { Button } from "./ui/button";

function srcOf(webmPath: string | undefined): string | null {
  if (!webmPath) return null;
  return `/captures/${webmPath.split(/[\\/]/).pop()}`;
}

export function Preview() {
  const { state, selectedSceneIndex, setSelected, capturing } = useUi();
  const [previewing, setPreviewing] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const queue = state
    ? state.scenes.flatMap((r, i) => (r.webmPath ? [{ index: i, src: srcOf(r.webmPath)!, title: r.title }] : []))
    : [];

  useEffect(() => {
    if (!previewing) return;
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
  }, [previewing, previewIndex]);

  if (!state) return null;

  if (previewing) {
    if (queue.length === 0) {
      setPreviewing(false);
      return null;
    }
    const cur = queue[previewIndex];
    const onEnded = () => {
      if (previewIndex + 1 < queue.length) {
        setPreviewIndex(previewIndex + 1);
      } else {
        setPreviewing(false);
        setPreviewIndex(0);
      }
    };
    return (
      <div className="p-3 flex flex-col gap-2 h-full">
        <div className="flex justify-between items-center flex-shrink-0">
          <div className="font-semibold flex items-center gap-3">
            <span className="text-accent">▶ Preview</span>
            <span className="opacity-80">
              {previewIndex + 1} / {queue.length} · {cur.title}
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPreviewing(false);
              setPreviewIndex(0);
            }}
          >
            ✕ Stop preview
          </Button>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="aspect-video max-w-full max-h-full bg-zinc-900 rounded overflow-hidden relative">
            <video
              key={cur.src}
              ref={videoRef}
              controls
              autoPlay
              src={cur.src}
              onEnded={onEnded}
              className="w-full h-full object-contain"
            />
            <div className="absolute top-2 left-2 bg-black/60 text-zinc-100 text-xs px-2 py-1 rounded">
              Scene {cur.index + 1} · {cur.title}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedSceneIndex === null) {
    return (
      <div className="p-6 flex flex-col gap-3 items-start h-full">
        <div className="opacity-60 text-sm">Select a scene from the rail.</div>
        {queue.length > 0 && (
          <Button
            size="sm"
            onClick={() => {
              setPreviewIndex(0);
              setPreviewing(true);
            }}
          >
            ▶ Preview all ({queue.length})
          </Button>
        )}
      </div>
    );
  }

  const row = state.scenes[selectedSceneIndex];
  const src = srcOf(row.webmPath);
  const isCapturing = capturing.includes(selectedSceneIndex);
  return (
    <div className="p-3 flex flex-col gap-2 h-full">
      <div className="flex justify-between items-center flex-shrink-0">
        <div className="font-semibold">
          Scene {selectedSceneIndex + 1} · {row.title}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={queue.length === 0 || isCapturing}
            onClick={() => {
              setPreviewIndex(0);
              setPreviewing(true);
              setSelected(null);
            }}
          >
            ▶ Preview all
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="aspect-video max-w-full max-h-full bg-zinc-900 rounded overflow-hidden relative flex items-center justify-center">
          {src ? (
            <video key={src} controls src={src} className="w-full h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-xs opacity-70 text-center px-4">
              <span>No capture yet for this scene.</span>
              <span className="opacity-60">Use “Capture all” in the sidebar to record.</span>
            </div>
          )}
          {isCapturing && (
            <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-2 text-zinc-100">
              <div className="h-8 w-8 rounded-full border-2 border-zinc-100/30 border-t-accent animate-spin" />
              <div className="text-sm font-medium">Capturing scene {selectedSceneIndex + 1}…</div>
              <div className="text-[11px] opacity-70">
                Running Playwright against {state.demoFile.split(/[\\/]/).pop()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
