// src/transitions.ts
import type { TransitionConfig, TransitionType } from "./types.js";

const XFADE_NAME: Record<Exclude<TransitionType, "none">, string> = {
  "crossfade":    "fade",
  "dip-to-black": "fadeblack",
  "slide-left":   "slideleft",
  "slide-right":  "slideright",
};

export interface BuildTransitionArgs {
  inLabelA: string;          // e.g. "[v0]"
  inLabelB: string;          // e.g. "[v1]"
  clipADurationMs: number;
  clipBDurationMs?: number;  // when known, lets the result report a true output duration
  transition: TransitionConfig;
  outLabel: string;          // e.g. "[v01]"
}

export interface BuildTransitionResult {
  filter: string;
  /** Joined-clip duration (ms). For xfade: clipA + clipB - transition. For concat: clipA + clipB. If clipB is unknown, returns clipA. */
  outputDurationMs: number;
}

export function buildTransitionFilter(args: BuildTransitionArgs): BuildTransitionResult {
  const { inLabelA, inLabelB, clipADurationMs, clipBDurationMs, transition, outLabel } = args;
  if (transition.type === "none") {
    const total = clipBDurationMs !== undefined ? clipADurationMs + clipBDurationMs : clipADurationMs;
    return {
      filter: `${inLabelA}${inLabelB}concat=n=2:v=1:a=0${outLabel}`,
      outputDurationMs: total,
    };
  }
  const name = XFADE_NAME[transition.type];
  const durationS = (transition.durationMs / 1000).toFixed(3);
  const offsetS = ((clipADurationMs - transition.durationMs) / 1000).toFixed(3);
  const total = clipBDurationMs !== undefined
    ? clipADurationMs + clipBDurationMs - transition.durationMs
    : clipADurationMs;
  return {
    filter: `${inLabelA}${inLabelB}xfade=transition=${name}:duration=${durationS}:offset=${offsetS}${outLabel}`,
    outputDurationMs: total,
  };
}
