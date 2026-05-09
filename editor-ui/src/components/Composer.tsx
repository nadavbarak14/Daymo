import { useState } from "react";
import { useUi } from "../store";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";

type Target = { kind: "caption" } | { kind: "overlay"; index: number };

export function ComposerInline({ sceneIndex, target }: { sceneIndex: number; target: Target }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const addDraft = useUi((s) => s.addDraft);
  if (!open) {
    return (
      <button className="text-[11px] text-accent mt-1.5" onClick={() => setOpen(true)}>
        + comment
      </button>
    );
  }
  return (
    <div className="bg-warn/10 border-l-2 border-warn rounded p-2 mt-1.5 flex flex-col gap-2">
      <Textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What should change?"
      />
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setText("");
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (!text.trim()) return;
            addDraft({
              sceneIndex,
              targetKind: target.kind,
              targetIndex: target.kind === "overlay" ? target.index : undefined,
              text: text.trim(),
            });
            setText("");
            setOpen(false);
          }}
        >
          Add draft
        </Button>
      </div>
    </div>
  );
}

export function DraftList({ sceneIndex }: { sceneIndex: number }) {
  const { drafts, removeDraft } = useUi();
  const here = drafts.filter((d) => d.sceneIndex === sceneIndex);
  if (here.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-2">
      {here.map((d) => (
        <div key={d.id} className="bg-warn/10 border-l-2 border-warn rounded p-2 text-xs">
          <div className="flex justify-between text-[10px] opacity-70 mb-1">
            <span>
              💬 DRAFT · scene {d.sceneIndex + 1} · {d.targetKind}
              {d.targetIndex !== undefined ? ` ${d.targetIndex + 1}` : ""}
            </span>
            <button onClick={() => removeDraft(d.id)}>×</button>
          </div>
          {d.text}
        </div>
      ))}
    </div>
  );
}
