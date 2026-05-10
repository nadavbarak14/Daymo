import { useState } from "react";
import { useUi } from "../store";
import { api } from "../lib/api";
import { Button } from "./ui/button";

export function StitchBar() {
  const { state } = useUi();
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  if (!state) return null;
  const hasPending = state.scenes.some((r) => r.state === "pending");
  const captured = state.scenes.filter((r) => r.state === "captured").length;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] opacity-60">
        {captured}/{state.scenes.length} captured
      </span>
      <Button
        size="sm"
        disabled={hasPending || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api.stitch();
            setOutput(r.output);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Stitching…" : "Stitch ⏵"}
      </Button>
      {output && <span className="text-[10px] opacity-60 truncate max-w-[200px]">→ {output}</span>}
    </div>
  );
}
