import { useEffect } from "react";
import { useUi } from "./store";
import { useSse } from "./lib/sse";
import { api } from "./lib/api";
import { Rail } from "./components/Rail";
import { Preview } from "./components/Preview";
import { SceneTabs } from "./components/Tabs";
import { ReviewBar } from "./components/ReviewBar";
import { PanelToggle } from "./components/PanelToggle";

export function App() {
  const { setState, patchScene, markCapturing, clearCapturing, panelOpen } = useUi();
  useEffect(() => {
    api.state().then(setState).catch(console.error);
  }, [setState]);
  useSse((evt) => {
    if (evt.type === "state") setState(evt.state);
    if (evt.type === "capture-start") markCapturing(evt.sceneIndex);
    if (evt.type === "capture-done") {
      clearCapturing(evt.sceneIndex);
      patchScene(evt.sceneIndex, { state: "captured", webmPath: evt.webmPath });
    }
    if (evt.type === "capture-error") clearCapturing(evt.sceneIndex);
    if (evt.type === "demo-changed") api.state().then(setState);
  });
  return (
    <div className="h-screen flex">
      <div className="w-[30%] border-r border-zinc-800 overflow-auto">
        <Rail />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-zinc-800 flex justify-end flex-shrink-0">
          <ReviewBar />
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <Preview />
        </div>
        <div className="flex-shrink-0">
          <PanelToggle />
          {panelOpen && (
            <div className="max-h-[42vh] min-h-[200px] overflow-auto border-t border-zinc-800">
              <SceneTabs />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
