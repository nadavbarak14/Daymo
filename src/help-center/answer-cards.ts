import type { Part } from "../types.js";

export interface DemoCardRef {
  demoId: string;
  /** Index in parts[] where this demo's card renders (its first video part). */
  partIndex: number;
  /** Earliest referenced step start — the cue point. */
  startMs: number;
  /** End of the latest referenced step — the widget's soft-stop point. */
  endMs: number;
  /** Referenced steps in the order the model cited them. */
  steps: Array<{ stepId: string; startMs: number; caption: string }>;
  mp4Url: string;
}

/** Collapse an answer's video parts into one card per demo, keyed by the
 *  parts[] index where the card should render. A VideoPart is a cue
 *  reference, not a clip — N references to one demo are one card. */
export function groupVideoParts(parts: Part[]): Map<number, DemoCardRef> {
  const byDemo = new Map<string, DemoCardRef>();
  parts.forEach((p, i) => {
    if (p.kind !== "video") return;
    let ref = byDemo.get(p.demoId);
    if (!ref) {
      ref = { demoId: p.demoId, partIndex: i, startMs: p.startMs, endMs: p.endMs, steps: [], mp4Url: p.mp4Url };
      byDemo.set(p.demoId, ref);
    }
    ref.startMs = Math.min(ref.startMs, p.startMs);
    ref.endMs = Math.max(ref.endMs, p.endMs);
    ref.steps.push({ stepId: p.stepId, startMs: p.startMs, caption: p.caption });
  });
  return new Map([...byDemo.values()].map((r) => [r.partIndex, r]));
}
