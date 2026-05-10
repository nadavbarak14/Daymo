import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Script } from "./Script";
import { Overlays } from "./Overlays";
import { Errors } from "./Errors";
import { useUi } from "../store";

export function SceneTabs() {
  const { state, selectedSceneIndex } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  const showOverlays = row.overlays.length > 0;
  const showErrors = !!row.errorMessage;
  return (
    <Tabs defaultValue="script" className="flex-1 overflow-auto flex flex-col">
      <TabsList className="px-3 flex">
        <TabsTrigger value="script">Script</TabsTrigger>
        {showOverlays && <TabsTrigger value="overlays">Overlays · {row.overlays.length}</TabsTrigger>}
        {showErrors && <TabsTrigger value="errors">Errors</TabsTrigger>}
      </TabsList>
      <TabsContent value="script">
        <Script />
      </TabsContent>
      {showOverlays && (
        <TabsContent value="overlays">
          <Overlays />
        </TabsContent>
      )}
      {showErrors && (
        <TabsContent value="errors">
          <Errors />
        </TabsContent>
      )}
    </Tabs>
  );
}
