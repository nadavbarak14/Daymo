import { useState } from "react";
import { useUi } from "../store";
import { api } from "../lib/api";
import { Button } from "./ui/button";

/** Extract the most useful tidbit from an ffmpeg stderr line:
 *  - `frame=` / `time=` progress lines → "time=…  fps=…"
 *  - everything else → first ~80 chars
 *  Returns null when the line is empty/whitespace. */
function summarize(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const time = /time=([\d:.]+)/.exec(line);
  const fps = /fps=\s*([\d.]+)/.exec(line);
  const speed = /speed=\s*([\d.]+x)/.exec(line);
  const size = /size=\s*([^\s]+)/.exec(line);
  if (time || fps) {
    const parts: string[] = [];
    if (time) parts.push(`t=${time[1]}`);
    if (fps) parts.push(`${fps[1]} fps`);
    if (speed) parts.push(speed[1]);
    if (size) parts.push(size[1]);
    return parts.join("  ");
  }
  return trimmed.length > 90 ? trimmed.slice(0, 87) + "…" : trimmed;
}

export function StitchBar() {
  const { state, stitching, stitchLine, stitchError } = useUi();
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  if (!state) return null;
  const hasPending = state.scenes.some((r) => r.state === "pending");
  const captured = state.scenes.filter((r) => r.state === "captured").length;
  const active = busy || stitching;
  const progress = stitchLine ? summarize(stitchLine) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] opacity-60">
          {captured}/{state.scenes.length} captured
        </span>
        <Button
          size="sm"
          disabled={hasPending || active}
          onClick={async () => {
            setBusy(true);
            setOutput(null);
            try {
              const r = await api.stitch();
              setOutput(r.output);
            } catch (e) {
              console.error("stitch failed:", e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {active ? "Stitching…" : "Stitch ⏵"}
        </Button>
      </div>
      {active && (
        <div className="flex items-center gap-2 text-[10px]">
          <div className="h-2 w-2 rounded-full bg-accent animate-pulse flex-shrink-0" />
          <span className="font-mono opacity-80 truncate" title={stitchLine ?? ""}>
            {progress ?? "starting ffmpeg…"}
          </span>
        </div>
      )}
      {!active && stitchError && (
        <div className="text-[10px] text-rose-300 font-mono break-words" title={stitchError}>
          ✕ {stitchError.length > 120 ? stitchError.slice(0, 117) + "…" : stitchError}
        </div>
      )}
      {!active && output && (
        <span
          className="text-[10px] opacity-60 font-mono select-all break-all"
          title={output}
        >
          → {output}
        </span>
      )}
    </div>
  );
}
