import { useUi } from "../store";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { formatReviewPrompt } from "../lib/prompt";

export function ReviewBar() {
  const { state, drafts, clearDrafts } = useUi();
  if (!state) return null;

  const copyAll = async () => {
    const md = formatReviewPrompt(state, drafts);
    await navigator.clipboard.writeText(md);
    const t = document.createElement("div");
    t.textContent = `Copied ${drafts.length} comment${drafts.length === 1 ? "" : "s"} — paste into Claude`;
    t.className = "fixed bottom-4 right-4 bg-accent/30 text-zinc-100 text-xs px-3 py-2 rounded";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  };

  return (
    <div className="flex items-center gap-2">
      {drafts.length > 0 && (
        <>
          <Badge className="border-warn/40 text-warn">
            {drafts.length} comment{drafts.length === 1 ? "" : "s"}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Clear ${drafts.length} comment${drafts.length === 1 ? "" : "s"}?`)) clearDrafts();
            }}
          >
            Clear
          </Button>
        </>
      )}
      <Button size="sm" disabled={drafts.length === 0} onClick={copyAll}>
        ⧉ Copy comments for Claude
      </Button>
    </div>
  );
}
