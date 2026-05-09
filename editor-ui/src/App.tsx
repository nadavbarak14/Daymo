import { useEffect } from "react";
import { useUi } from "./store";
import { useSse } from "./lib/sse";
import { api } from "./lib/api";
import { Rail } from "./components/Rail";
import { Preview } from "./components/Preview";
import { SceneTabs } from "./components/Tabs";

export function App() {
  const { setState, patchScene } = useUi();
  useEffect(() => {
    api.state().then(setState).catch(console.error);
  }, [setState]);
  useSse((evt) => {
    if (evt.type === "state") setState(evt.state);
    if (evt.type === "capture-done") patchScene(evt.sceneIndex, { state: "captured", webmPath: evt.webmPath });
    if (evt.type === "demo-changed") api.state().then(setState);
  });
  return (
    <div className="h-screen flex">
      <div className="w-[30%] border-r border-zinc-800 overflow-auto">
        <Rail />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <Preview />
        <SceneTabs />
      </div>
    </div>
  );
}
