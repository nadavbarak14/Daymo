import { useUi } from "../store";

export function PanelToggle() {
  const { state, selectedSceneIndex, drafts, panelOpen, togglePanel } = useUi();
  if (!state) return null;
  const overlayCount =
    selectedSceneIndex !== null ? state.scenes[selectedSceneIndex]?.overlays.length ?? 0 : 0;
  const sceneCommentCount =
    selectedSceneIndex !== null ? drafts.filter((d) => d.sceneIndex === selectedSceneIndex).length : 0;

  return (
    <div
      onClick={togglePanel}
      className="cursor-pointer w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900 transition-colors border-t border-zinc-800"
      title={panelOpen ? "Hide script & comments" : "Show script & comments"}
    >
      <div className="flex items-center gap-3">
        <span className="text-base leading-none">{panelOpen ? "▾" : "▸"}</span>
        <span className="font-medium">Script</span>
        {overlayCount > 0 && <span className="opacity-70">· Overlays {overlayCount}</span>}
        {sceneCommentCount > 0 && (
          <span className="text-warn">
            · 💬 {sceneCommentCount} comment{sceneCommentCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <span className="opacity-60">{panelOpen ? "Hide" : "Show"}</span>
    </div>
  );
}
