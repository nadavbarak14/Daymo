import { useUi } from "../store";

export function Overlays() {
  const { state, selectedSceneIndex } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  return (
    <div className="p-3 text-xs flex flex-col gap-2">
      {row.overlays.map((o, i) => (
        <div key={i} className="bg-zinc-900 rounded p-2">
          <div className="opacity-60 text-[10px] uppercase">Overlay · {o.type}</div>
          {o.target && (
            <div>
              target: <code>{o.target}</code>
            </div>
          )}
          {o.text && <div>text: {o.text}</div>}
          {o.duration && <div>duration: {o.duration}</div>}
        </div>
      ))}
    </div>
  );
}
