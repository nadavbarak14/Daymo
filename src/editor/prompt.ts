// SYNC: keep this file identical in body to editor-ui/src/lib/prompt.ts.
import type { EditorState } from "./types.js";

export interface DraftLike {
  id: string;
  sceneIndex: number;
  targetKind:
    | "caption"
    | "overlay"
    | "step.description"
    | "step.say"
    | "step.banner";
  targetIndex?: number;
  stepIndex?: number;
  text: string;
}

export function formatReviewPrompt(state: EditorState, drafts: DraftLike[]): string {
  const lines: string[] = [];
  lines.push(`You're editing \`${state.demoFile}\`. The user has left these review comments —`);
  lines.push(`please apply them as a single edit. Do NOT touch scenes that are not mentioned.`);
  lines.push("");
  drafts.forEach((d, i) => {
    const row = state.scenes[d.sceneIndex];
    lines.push(`# Comment ${i + 1} — Scene ${d.sceneIndex + 1} (${d.targetKind})`);
    lines.push("");
    if (d.targetKind === "caption") {
      lines.push("Current text:");
      for (const ln of row.prose.split("\n")) lines.push(`> ${ln}`);
    } else if (d.targetKind === "overlay") {
      const ov = row.overlays[d.targetIndex ?? 0];
      lines.push("Current overlay:");
      lines.push("```yaml");
      lines.push(`type: ${ov.type}`);
      if (ov.target) lines.push(`target: "${ov.target}"`);
      if (ov.text) lines.push(`text: "${ov.text}"`);
      if (ov.duration) lines.push(`duration: ${ov.duration}`);
      lines.push("```");
    } else {
      // step.* kinds
      const step = row.steps[d.stepIndex ?? 0];
      const label = step?.description ?? "<preamble>";
      lines.push(`Step ${d.stepIndex ?? 0} — "${label}"`);
      if (d.targetKind === "step.description") {
        lines.push(`Current description: "${label}"`);
      } else if (d.targetKind === "step.say") {
        const t = step?.says[0]?.text ?? "<none>";
        lines.push(`Current fx.say: "${t}"`);
      } else if (d.targetKind === "step.banner") {
        const t = step?.banners[0]?.text ?? "<none>";
        lines.push(`Current fx.banner: "${t}"`);
      }
    }
    lines.push("");
    lines.push("User comment:");
    for (const ln of d.text.split("\n")) lines.push(`> ${ln}`);
    lines.push("");
  });
  return lines.join("\n");
}
