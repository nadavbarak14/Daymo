import { useUi } from "../store";

export function Errors() {
  const { state, selectedSceneIndex } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  if (!row.errorMessage) return null;
  return <div className="p-3 text-xs text-red-400 whitespace-pre-wrap">{row.errorMessage}</div>;
}
