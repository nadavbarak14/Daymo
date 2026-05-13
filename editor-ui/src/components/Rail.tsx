import { useState, type MouseEvent } from "react";
import { Badge } from "./ui/badge";
import { useUi } from "../store";
import { api } from "../lib/api";
import { StitchBar } from "./StitchBar";
import type { Step } from "../lib/types";

export function Rail() {
  const {
    state,
    selectedSceneIndex,
    setSelected,
    setFocusedStep,
    setPanelOpen,
    focusedStepIndex,
    drafts,
    capturing,
    markCapturing,
    pendingEdits,
  } = useUi();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const requestSeek = useUi((u) => u.requestSeek);
  const openStepOnRight = (sceneIndex: number, stepIndex: number, stepTimeMs?: number) => {
    setSelected(sceneIndex);
    setFocusedStep(stepIndex);
    setPanelOpen(true);
    if (stepTimeMs !== undefined) {
      requestSeek(sceneIndex, stepTimeMs / 1000);
    }
  };
  if (!state) return <div className="p-3 text-xs opacity-60">loading…</div>;
  const captureAll = () => {
    state.scenes.forEach((_, i) => {
      markCapturing(i);
      api.capture(i);
    });
  };
  const toggle = (i: number, e: MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  return (
    <div className="flex flex-col gap-2 p-3 overflow-auto h-full">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] tracking-wide uppercase opacity-60">Scenes · {state.scenes.length}</div>
        <button
          className="text-xs opacity-70 hover:opacity-100 disabled:opacity-40"
          disabled={capturing.length > 0}
          onClick={captureAll}
        >
          Capture all
        </button>
      </div>
      {state.scenes.map((r, i) => {
        const draftCount = drafts.filter((d) => d.sceneIndex === i).length;
        const pendingCount = pendingEdits.filter((p) => p.sceneIndex === i).length;
        const selected = selectedSceneIndex === i;
        const isCapturing = capturing.includes(i);
        const isOpen = !collapsed.has(i);
        const visibleSteps = r.steps
          .map((step, stepIndex) => ({ step, stepIndex }))
          .filter(({ step }) =>
            step.description !== undefined ||
            step.says.length > 0 ||
            step.banners.length > 0 ||
            step.highlights.length > 0 ||
            step.clicks.length > 0 ||
            step.cursors.length > 0,
          );
        return (
          <div key={i}>
            <div
              onClick={() => setSelected(i)}
              className={
                "cursor-pointer p-2 rounded text-xs " +
                (selected ? "bg-accent/40 outline outline-1 outline-accent" : "hover:bg-zinc-900")
              }
            >
              <div className="flex justify-between font-semibold items-center gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {visibleSteps.length > 0 && (
                    <span
                      onClick={(e) => toggle(i, e)}
                      className="opacity-60 hover:opacity-100 select-none w-3 text-center"
                      title={isOpen ? "Collapse steps" : "Expand steps"}
                    >
                      {isOpen ? "▾" : "▸"}
                    </span>
                  )}
                  <span className="truncate">
                    {i + 1}. {r.title}
                  </span>
                </div>
              </div>
              <div className="opacity-70 text-[10px] mt-0.5 flex gap-1.5 items-center pl-[18px]">
                {isCapturing ? (
                  <span className="flex items-center gap-1 text-accent">
                    <span className="h-2 w-2 rounded-full bg-accent animate-pulse" /> capturing…
                  </span>
                ) : (
                  <>
                    {r.state === "pending" && <span>⊘ pending</span>}
                    {r.state === "captured" && <span>🎬 captured</span>}
                  </>
                )}
                {draftCount > 0 && <Badge className="text-warn border-warn/40">💬 {draftCount}</Badge>}
                {pendingCount > 0 && <Badge className="text-warn border-warn/40">✎ {pendingCount} unsaved</Badge>}
              </div>
            </div>
            {isOpen && visibleSteps.length > 0 && (
              <div className="ml-3 mt-1 mb-0.5 border-l border-zinc-800 pl-2 flex flex-col gap-0.5">
                {visibleSteps.map(({ step, stepIndex }) => {
                  const isFocused = selectedSceneIndex === i && focusedStepIndex === stepIndex;
                  return (
                    <StepLine
                      key={stepIndex}
                      sceneIndex={i}
                      stepIndex={stepIndex}
                      step={step}
                      stepTimeMs={r.stepTimes?.[stepIndex]}
                      isFocused={isFocused}
                      stepDraftCount={drafts.filter((d) => d.sceneIndex === i && d.stepIndex === stepIndex).length}
                      onClick={() => {
                        if (isFocused) {
                          setFocusedStep(null);
                        } else {
                          openStepOnRight(i, stepIndex, r.stepTimes?.[stepIndex]);
                        }
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <div className="mt-auto pt-2 border-t border-zinc-800">
        <StitchBar />
      </div>
    </div>
  );
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function StepLine({
  sceneIndex,
  stepIndex,
  step,
  stepTimeMs,
  isFocused,
  stepDraftCount,
  onClick,
}: {
  sceneIndex: number;
  stepIndex: number;
  step: Step;
  stepTimeMs?: number;
  isFocused: boolean;
  stepDraftCount: number;
  onClick: () => void;
}) {
  const isPreamble = step.description === undefined;
  const label = isPreamble ? "Preamble" : `Step ${stepIndex}`;
  return (
    <div
      onClick={onClick}
      className={
        "cursor-pointer text-[11px] py-1 px-1.5 rounded flex flex-col gap-0.5 " +
        (isFocused ? "bg-accent/30 outline outline-1 outline-accent/60" : "hover:bg-zinc-900")
      }
    >
      <div className="flex items-baseline gap-1.5">
        <span className="opacity-50 text-[9px] uppercase tracking-wide flex-shrink-0">{label}</span>
        {stepTimeMs !== undefined && (
          <span
            className="font-mono text-[10px] text-accent/90 flex-shrink-0 tabular-nums"
            title={`Seek video to ${formatTime(stepTimeMs)} (${stepTimeMs} ms)`}
          >
            {formatTime(stepTimeMs)}
          </span>
        )}
        <span className={isPreamble ? "italic opacity-60 truncate" : "truncate font-medium"}>
          {isPreamble ? "(no description)" : step.description}
        </span>
        {stepDraftCount > 0 && (
          <span className="ml-auto text-warn flex-shrink-0">💬 {stepDraftCount}</span>
        )}
      </div>
      {step.says.length > 0 && (
        <StepTextLine kind="say" text={step.says[0].text} />
      )}
      {step.banners.length > 0 && (
        <StepTextLine kind="banner" text={step.banners[0].text} />
      )}
      {step.cursors.map((c, i) => (
        <StepActionLine key={`cu-${i}`} kind="cursor" selector={c.selector} description={c.description} />
      ))}
      {step.highlights.map((h, i) => (
        <StepActionLine key={`hl-${i}`} kind="highlight" selector={h.selector} description={h.description} />
      ))}
      {step.clicks.map((c, i) => (
        <StepActionLine key={`cl-${i}`} kind="click" selector={c.selector} description={c.description} />
      ))}
      {step.types.map((t, i) => (
        <StepTextLine key={`ty-${i}`} kind="type" text={t.text} />
      ))}
    </div>
  );
}

function StepTextLine({ kind, text }: { kind: "say" | "banner" | "type"; text: string }) {
  const colorByKind = {
    say: "text-sky-300/80",
    banner: "text-amber-300/80",
    type: "text-emerald-300/80",
  } as const;
  return (
    <div className="flex items-baseline gap-1.5 pl-12 text-[10px]">
      <span className={`uppercase tracking-wide flex-shrink-0 ${colorByKind[kind]}`}>{kind}</span>
      <span className="opacity-80 truncate" title={text}>
        “{text}”
      </span>
    </div>
  );
}

/** Renders an action line in the rail: shows the human description, with the
 *  selector visible in the tooltip. Falls back to selector when no description
 *  is present (page.click). */
function StepActionLine({
  kind,
  selector,
  description,
}: {
  kind: "highlight" | "click" | "cursor";
  selector: string;
  description: string;
}) {
  const colorByKind = {
    highlight: "text-fuchsia-300/80",
    click: "text-rose-300/80",
    cursor: "text-zinc-300/60",
  } as const;
  const hasDesc = description.length > 0;
  const tooltip = hasDesc ? `${description}\n${selector}` : selector;
  return (
    <div className="flex items-baseline gap-1.5 pl-12 text-[10px]">
      <span className={`uppercase tracking-wide flex-shrink-0 ${colorByKind[kind]}`}>{kind}</span>
      <span className="opacity-80 truncate" title={tooltip}>
        {hasDesc ? description : <span className="font-mono">{selector}</span>}
      </span>
    </div>
  );
}
