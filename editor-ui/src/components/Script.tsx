import type { FocusEvent } from "react";
import { useUi } from "../store";
import { api } from "../lib/api";
import { ComposerInline, DraftList } from "./Composer";
import type { Step } from "../lib/types";

export function Script() {
  const { state, selectedSceneIndex } = useUi();
  if (!state || selectedSceneIndex === null) return null;
  const row = state.scenes[selectedSceneIndex];
  return (
    <div className="p-3 text-xs flex flex-col gap-3">
      <div className="opacity-60 text-[10px] uppercase tracking-wide">
        Scene · {row.steps.length} step{row.steps.length === 1 ? "" : "s"}
      </div>
      {row.steps.map((step, stepIndex) => (
        <StepRow
          key={stepIndex}
          sceneIndex={selectedSceneIndex}
          stepIndex={stepIndex}
          step={step}
        />
      ))}
      <DraftList sceneIndex={selectedSceneIndex} />
    </div>
  );
}

function StepRow({
  sceneIndex,
  stepIndex,
  step,
}: {
  sceneIndex: number;
  stepIndex: number;
  step: Step;
}) {
  const isPreamble = step.description === undefined;
  const onDescBlur = async (e: FocusEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText.trim();
    if (text === step.description) return;
    await api.setStep(sceneIndex, stepIndex, "description", text);
  };
  const onSayBlur = async (e: FocusEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText.trim();
    if (text === step.says[0]?.text) return;
    await api.setStep(sceneIndex, stepIndex, "say", text);
  };
  const onBannerBlur = async (e: FocusEvent<HTMLDivElement>) => {
    const text = e.currentTarget.innerText.trim();
    if (text === step.banners[0]?.text) return;
    await api.setStep(sceneIndex, stepIndex, "banner", text);
  };
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
            contentEditable
            suppressContentEditableWarning
            className="flex-1 p-1 rounded bg-zinc-900 outline-none focus:ring-1 focus:ring-zinc-500"
            onBlur={onDescBlur}
          >
            {step.description}
          </div>
        )}
      </div>

      {step.says.length > 0 && (
        <div className="flex items-baseline gap-2">
          <span className="opacity-50 text-[10px] uppercase tracking-wide w-14 flex-shrink-0">Say</span>
          <div
            contentEditable
            suppressContentEditableWarning
            className="flex-1 p-1 rounded bg-zinc-900 outline-none focus:ring-1 focus:ring-zinc-500"
            onBlur={onSayBlur}
          >
            {step.says[0].text}
          </div>
        </div>
      )}

      {step.banners.length > 0 && (
        <div className="flex items-baseline gap-2">
          <span className="opacity-50 text-[10px] uppercase tracking-wide w-14 flex-shrink-0">Banner</span>
          <div
            contentEditable
            suppressContentEditableWarning
            className="flex-1 p-1 rounded bg-zinc-900 outline-none focus:ring-1 focus:ring-zinc-500"
            onBlur={onBannerBlur}
          >
            {step.banners[0].text}
          </div>
        </div>
      )}

      {!isPreamble && (
        <ComposerInline
          sceneIndex={sceneIndex}
          target={{ kind: "step.description", stepIndex }}
        />
      )}
    </div>
  );
}
