import { useEffect, useState } from "react";
import { useUi } from "../store";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { formatReviewPrompt } from "../lib/prompt";

type Target =
  | { kind: "caption" }
  | { kind: "overlay"; index: number }
  | { kind: "step.description"; stepIndex: number }
  | { kind: "step.say"; stepIndex: number }
  | { kind: "step.banner"; stepIndex: number };

const targetLabel = (t: Target) => {
  if (t.kind === "caption") return "the caption";
  if (t.kind === "overlay") return `overlay #${t.index + 1}`;
  if (t.kind === "step.description") return `step ${t.stepIndex} description`;
  if (t.kind === "step.say") return `step ${t.stepIndex} subtitle`;
  return `step ${t.stepIndex} banner`;
};

function toast(text: string) {
  const t = document.createElement("div");
  t.textContent = text;
  t.className = "fixed bottom-4 right-4 bg-accent/30 text-zinc-100 text-xs px-3 py-2 rounded";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

export function ComposerInline({ sceneIndex, target }: { sceneIndex: number; target: Target }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const addDraft = useUi((s) => s.addDraft);
  const composeRequest = useUi((s) => s.composeRequest);
  const clearComposeRequest = useUi((s) => s.clearComposeRequest);
  useEffect(() => {
    if (
      composeRequest &&
      composeRequest.sceneIndex === sceneIndex &&
      target.kind === "caption"
    ) {
      setOpen(true);
      clearComposeRequest();
    }
  }, [composeRequest, sceneIndex, target.kind, clearComposeRequest]);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full text-left px-3 py-2 rounded border border-dashed border-zinc-700 hover:border-accent hover:bg-accent/5 text-xs text-zinc-300 transition-colors"
      >
        💬 Add a comment on {targetLabel(target)}
      </button>
    );
  }
  const submit = () => {
    if (!text.trim()) return;
    addDraft({
      sceneIndex,
      targetKind: target.kind,
      targetIndex: target.kind === "overlay" ? target.index : undefined,
      stepIndex:
        target.kind === "step.description" ||
        target.kind === "step.say" ||
        target.kind === "step.banner"
          ? target.stepIndex
          : undefined,
      text: text.trim(),
    });
    setText("");
    setOpen(false);
  };
  return (
    <div className="bg-warn/10 border-l-2 border-warn rounded p-3 mt-2 flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-wide opacity-70">
        New comment · {targetLabel(target)}
      </div>
      <Textarea
        rows={4}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="What should change here?  (⌘/Ctrl+Enter to add)"
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
        <Button size="sm" disabled={!text.trim()} onClick={submit}>
          Add comment
        </Button>
      </div>
    </div>
  );
}

export function DraftList({ sceneIndex }: { sceneIndex: number }) {
  const { state, drafts, removeDraft } = useUi();
  const here = drafts.filter((d) => d.sceneIndex === sceneIndex);
  if (here.length === 0) return null;

  const copyOne = async (id: string) => {
    if (!state) return;
    const d = drafts.find((x) => x.id === id);
    if (!d) return;
    const md = formatReviewPrompt(state, [d]);
    await navigator.clipboard.writeText(md);
    toast("Comment + context copied");
  };

  return (
    <div className="flex flex-col gap-2 mt-3">
      <div className="text-[10px] uppercase tracking-wide opacity-60">
        Comments on this scene · {here.length}
      </div>
      {here.map((d) => (
        <div key={d.id} className="bg-warn/10 border-l-2 border-warn rounded p-2 text-xs">
          <div className="flex justify-between items-center text-[10px] opacity-70 mb-1">
            <span>
              💬 {d.targetKind}
              {d.targetIndex !== undefined ? ` #${d.targetIndex + 1}` : ""}
            </span>
            <div className="flex gap-2">
              <button onClick={() => copyOne(d.id)} className="hover:text-accent">
                Copy
              </button>
              <button onClick={() => removeDraft(d.id)} className="hover:text-red-400">
                Remove
              </button>
            </div>
          </div>
          <div className="whitespace-pre-wrap">{d.text}</div>
        </div>
      ))}
    </div>
  );
}
