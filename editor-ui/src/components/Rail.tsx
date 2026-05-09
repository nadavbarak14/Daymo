import { Badge } from "./ui/badge";
import { useUi } from "../store";
import { api } from "../lib/api";

export function Rail() {
  const { state, selectedSceneIndex, setSelected, drafts } = useUi();
  if (!state) return <div className="p-3 text-xs opacity-60">loading…</div>;
  return (
    <div className="flex flex-col gap-2 p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] tracking-wide uppercase opacity-60">Scenes · {state.scenes.length}</div>
        <button
          className="text-xs opacity-70 hover:opacity-100"
          onClick={() => state.scenes.forEach((_, i) => api.capture(i))}
        >
          Capture all
        </button>
      </div>
      {state.scenes.map((r, i) => {
        const draftCount = drafts.filter((d) => d.sceneIndex === i).length;
        const selected = selectedSceneIndex === i;
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
            <div className="opacity-70 text-[10px] mt-0.5 flex gap-1.5">
              {r.state === "pending" && <span>⊘ pending</span>}
              {r.state === "captured" && <span>🎬 captured</span>}
              {r.state === "approved" && <span>✓ approved</span>}
              {draftCount > 0 && <Badge className="text-warn border-warn/40">💬 {draftCount} draft</Badge>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
