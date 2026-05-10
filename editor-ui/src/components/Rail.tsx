import { Badge } from "./ui/badge";
import { useUi } from "../store";
import { api } from "../lib/api";
import { StitchBar } from "./StitchBar";

export function Rail() {
  const { state, selectedSceneIndex, setSelected, drafts, capturing, markCapturing } = useUi();
  if (!state) return <div className="p-3 text-xs opacity-60">loading…</div>;
  const captureAll = () => {
    state.scenes.forEach((_, i) => {
      markCapturing(i);
      api.capture(i);
    });
  };
  return (
    <div className="flex flex-col gap-2 p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] tracking-wide uppercase opacity-60">Scenes · {state.scenes.length}</div>
        <button
          className="text-xs opacity-70 hover:opacity-100 disabled:opacity-40"
          disabled={capturing.length > 0}
          onClick={captureAll}
        >
          Capture all
        </button>
      </div>
      {state.scenes.map((r, i) => {
        const draftCount = drafts.filter((d) => d.sceneIndex === i).length;
        const selected = selectedSceneIndex === i;
        const isCapturing = capturing.includes(i);
        return (
          <div
            key={i}
            onClick={() => setSelected(i)}
            className={
              "cursor-pointer p-2 rounded text-xs " +
              (selected ? "bg-accent/40 outline outline-1 outline-accent" : "hover:bg-zinc-900")
            }
          >
            <div className="flex justify-between font-semibold">
              <span>
                {i + 1}. {r.title}
              </span>
            </div>
            <div className="opacity-70 text-[10px] mt-0.5 flex gap-1.5 items-center">
              {isCapturing ? (
                <span className="flex items-center gap-1 text-accent">
                  <span className="h-2 w-2 rounded-full bg-accent animate-pulse" /> capturing…
                </span>
              ) : (
                <>
                  {r.state === "pending" && <span>⊘ pending</span>}
                  {r.state === "captured" && <span>🎬 captured</span>}
                  {r.state === "approved" && <span>✓ approved</span>}
                </>
              )}
              {draftCount > 0 && <Badge className="text-warn border-warn/40">💬 {draftCount}</Badge>}
            </div>
          </div>
        );
      })}
      <div className="mt-auto pt-2 border-t border-zinc-800">
        <StitchBar />
      </div>
    </div>
  );
}
