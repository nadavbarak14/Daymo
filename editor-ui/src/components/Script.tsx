import type { FocusEvent } from "react";
import { useUi, type PendingStepEdit } from "../store";
import { api } from "../lib/api";
import { ComposerInline, DraftList } from "./Composer";
import type { Step } from "../lib/types";

type Kind = PendingStepEdit["kind"];

export function Script() {
  const {
    state,
    selectedSceneIndex,
    focusedStepIndex,
    setFocusedStep,
    pendingEdits,
    clearPendingEdits,
    markCapturing,
    capturing,
  } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  const focusedStep =
    focusedStepIndex !== null && focusedStepIndex < row.steps.length
      ? row.steps[focusedStepIndex]
      : null;
  const pendingForScene = pendingEdits.filter((p) => p.sceneIndex === selectedSceneIndex);
  const isCapturing = capturing.includes(selectedSceneIndex);

  const onSave = async () => {
    for (const e of pendingForScene) {
      try {
        await api.setStep(e.sceneIndex, e.stepIndex, e.kind, e.text, e.typeIndex);
      } catch (err) {
        console.error("save failed:", err);
        return;
      }
    }
    clearPendingEdits(selectedSceneIndex);
  };

  const onRecapture = () => {
    markCapturing(selectedSceneIndex);
    api.capture(selectedSceneIndex).catch((err) => console.error("capture failed:", err));
  };

  const stepTimeMs =
    focusedStep && focusedStepIndex !== null ? row.stepTimes?.[focusedStepIndex] : undefined;
  const focusedLabel = focusedStep
    ? focusedStep.description === undefined
      ? "Preamble"
      : `Step ${focusedStepIndex}`
    : null;

  return (
    <div className="p-3 text-xs flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {focusedStep && (
            <button
              onClick={() => setFocusedStep(null)}
              className="text-[10px] uppercase tracking-wide opacity-70 hover:opacity-100 hover:text-accent flex-shrink-0"
            >
              ← All steps
            </button>
          )}
          <span className="opacity-60 text-[10px] uppercase tracking-wide truncate">
            {row.title}
            {focusedLabel ? ` · ${focusedLabel}` : ` · ${row.steps.length} step${row.steps.length === 1 ? "" : "s"}`}
          </span>
          {stepTimeMs !== undefined && (
            <span className="font-mono text-accent/90 tabular-nums text-[10px] flex-shrink-0">
              {formatTime(stepTimeMs)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pendingForScene.length > 0 && (
            <span className="text-warn text-[10px] uppercase tracking-wide">
              {pendingForScene.length} unsaved
            </span>
          )}
          <button
            onClick={onSave}
            disabled={pendingForScene.length === 0}
            className="px-2 py-0.5 rounded bg-warn/40 hover:bg-warn/60 disabled:bg-zinc-800 disabled:text-zinc-500 text-[10px] uppercase tracking-wide"
          >
            Save
          </button>
          <button
            onClick={onRecapture}
            disabled={isCapturing}
            className="px-2 py-0.5 rounded bg-accent/40 hover:bg-accent/60 disabled:opacity-40 text-[10px] uppercase tracking-wide"
          >
            {isCapturing ? "Capturing…" : "Recapture"}
          </button>
        </div>
      </div>

      {!focusedStep && (
        <div className="opacity-60 text-[10px] tracking-wide">
          click a step in the rail to edit just that one
        </div>
      )}

      {focusedStep ? (
        <StepRow
          sceneIndex={selectedSceneIndex}
          stepIndex={focusedStepIndex!}
          step={focusedStep}
        />
      ) : (
        row.steps.map((step, stepIndex) => (
          <StepRow
            key={stepIndex}
            sceneIndex={selectedSceneIndex}
            stepIndex={stepIndex}
            step={step}
          />
        ))
      )}

      <DraftList sceneIndex={selectedSceneIndex} />
    </div>
  );
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function StepRow({
  sceneIndex,
  stepIndex,
  step,
}: {
  sceneIndex: number;
  stepIndex: number;
  step: Step;
}) {
  const { pendingEdits, setPendingEdit, removePendingEdit } = useUi();
  const isPreamble = step.description === undefined;

  const getPending = (kind: Kind, typeIndex?: number) =>
    pendingEdits.find(
      (p) =>
        p.sceneIndex === sceneIndex &&
        p.stepIndex === stepIndex &&
        p.kind === kind &&
        (p.typeIndex ?? 0) === (typeIndex ?? 0),
    );

  const stage = (kind: Kind, currentValue: string | undefined, text: string, typeIndex?: number) => {
    if (text === (currentValue ?? "")) {
      removePendingEdit(sceneIndex, stepIndex, kind, typeIndex);
    } else {
      setPendingEdit({ sceneIndex, stepIndex, kind, text, typeIndex });
    }
  };

  const ringClass = (pending: boolean) =>
    pending
      ? "ring-1 ring-warn/70 bg-warn/10"
      : "focus:ring-1 focus:ring-zinc-500";

  const descPending = getPending("description");
  const sayPending = getPending("say");
  const bannerPending = getPending("banner");

  return (
    <div className="border border-zinc-800 rounded p-2 flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="opacity-50 text-[10px] uppercase tracking-wide">
          {isPreamble ? "Preamble" : `Step ${stepIndex}`}
        </span>
        {isPreamble ? (
          <span className="opacity-50 italic">(no description — add fx.step() in source)</span>
        ) : (
          <div
            key={`desc:${descPending?.text ?? step.description ?? ""}`}
            contentEditable
            suppressContentEditableWarning
            className={`flex-1 p-1 rounded bg-zinc-900 outline-none ${ringClass(!!descPending)}`}
            onBlur={(e: FocusEvent<HTMLDivElement>) =>
              stage("description", step.description, e.currentTarget.innerText.trim())
            }
          >
            {descPending?.text ?? step.description}
          </div>
        )}
      </div>

      {step.says.length > 0 && (
        <div className="flex items-baseline gap-2">
          <span className="opacity-50 text-[10px] uppercase tracking-wide w-14 flex-shrink-0">Say</span>
          <div
            key={`say:${sayPending?.text ?? step.says[0].text}`}
            contentEditable
            suppressContentEditableWarning
            className={`flex-1 p-1 rounded bg-zinc-900 outline-none ${ringClass(!!sayPending)}`}
            onBlur={(e: FocusEvent<HTMLDivElement>) =>
              stage("say", step.says[0].text, e.currentTarget.innerText.trim())
            }
          >
            {sayPending?.text ?? step.says[0].text}
          </div>
        </div>
      )}

      {step.banners.length > 0 && (
        <div className="flex items-baseline gap-2">
          <span className="opacity-50 text-[10px] uppercase tracking-wide w-14 flex-shrink-0">Banner</span>
          <div
            key={`banner:${bannerPending?.text ?? step.banners[0].text}`}
            contentEditable
            suppressContentEditableWarning
            className={`flex-1 p-1 rounded bg-zinc-900 outline-none ${ringClass(!!bannerPending)}`}
            onBlur={(e: FocusEvent<HTMLDivElement>) =>
              stage("banner", step.banners[0].text, e.currentTarget.innerText.trim())
            }
          >
            {bannerPending?.text ?? step.banners[0].text}
          </div>
        </div>
      )}

      {step.types.map((t, i) => {
        const typePending = getPending("type", i);
        return (
          <div key={i} className="flex items-baseline gap-2">
            <span className="opacity-50 text-[10px] uppercase tracking-wide w-14 flex-shrink-0">
              Type{step.types.length > 1 ? ` ${i + 1}` : ""}
            </span>
            <div
              key={`type:${i}:${typePending?.text ?? t.text}`}
              contentEditable
              suppressContentEditableWarning
              className={`flex-1 p-1 rounded bg-zinc-900 outline-none font-mono text-emerald-300/90 ${ringClass(!!typePending)}`}
              onBlur={(e: FocusEvent<HTMLDivElement>) =>
                stage("type", t.text, e.currentTarget.innerText.trim(), i)
              }
            >
              {typePending?.text ?? t.text}
            </div>
          </div>
        );
      })}

      {!isPreamble && (
        <ComposerInline
          sceneIndex={sceneIndex}
          target={{ kind: "step.description", stepIndex }}
        />
      )}
    </div>
  );
}
