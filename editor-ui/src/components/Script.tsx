import type { FocusEvent } from "react";
import { useUi } from "../store";
import { api } from "../lib/api";
import { ComposerInline, DraftList } from "./Composer";

export function Script() {
  const { state, selectedSceneIndex, patchScene } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];

  const onBlur = async (e: FocusEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText.trim();
    if (text === row.prose) return;
    await api.setProse(selectedSceneIndex, text);
    patchScene(selectedSceneIndex, { prose: text });
  };

  return (
    <div className="p-3 text-xs">
      <div className="opacity-60 text-[10px] uppercase tracking-wide mb-1">Caption · click to edit</div>
      <div
        contentEditable
        suppressContentEditableWarning
        className="p-2 rounded bg-zinc-900 outline-none focus:ring-1 focus:ring-zinc-500 whitespace-pre-wrap"
        onBlur={onBlur}
      >
        {row.prose}
      </div>
      <ComposerInline sceneIndex={selectedSceneIndex} target={{ kind: "caption" }} />
      <DraftList sceneIndex={selectedSceneIndex} />
    </div>
  );
}
