import { useUi } from "../store";
import { api } from "../lib/api";
import { Button } from "./ui/button";

export function Preview() {
  const { state, selectedSceneIndex, patchScene } = useUi();
  if (!state || selectedSceneIndex === null)
    return <div className="p-6 opacity-60 text-sm">Select a scene from the rail.</div>;
  const row = state.scenes[selectedSceneIndex];
  const src = row.webmPath ? `/captures/${row.webmPath.split("/").pop()}` : null;
  return (
    <div className="p-3 border-b border-zinc-800 flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <div className="font-semibold">
          Scene {selectedSceneIndex + 1} · {row.title}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => api.capture(selectedSceneIndex)}>
            {src ? "Re-capture" : "Capture"}
          </Button>
          {row.state !== "pending" && (
            <Button
              size="sm"
              onClick={async () => {
                const next = row.state === "approved" ? "captured" : "approved";
                await api.approve(selectedSceneIndex, next === "approved");
                patchScene(selectedSceneIndex, { state: next });
              }}
            >
              {row.state === "approved" ? "Unapprove" : "✓ Approve"}
            </Button>
          )}
        </div>
      </div>
      <div className="aspect-video bg-zinc-900 rounded flex items-center justify-center overflow-hidden">
        {src ? (
          <video controls src={src} className="max-h-full" />
        ) : (
          <span className="text-xs opacity-60">No capture yet — click Capture above.</span>
        )}
      </div>
    </div>
  );
}
