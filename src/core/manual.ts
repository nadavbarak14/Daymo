import type { DemoAst, Step } from "../types.js";

export interface ManualWarning {
  /** 1-based source line that produced the warning. */
  line: number;
  /** Short, human-readable explanation. */
  detail: string;
}

export interface ManualOutput {
  markdown: string;
  warnings: ManualWarning[];
}

export type ActionRow =
  | { kind: "click"; selector: string; description: string; line: number }
  | { kind: "highlight"; selector: string; description: string; line: number }
  | { kind: "cursor"; selector: string; description: string; line: number }
  | { kind: "type"; text: string; line: number };

export function actionsInSourceOrder(stp: Step): ActionRow[] {
  const rows: ActionRow[] = [
    ...stp.clicks.map((a): ActionRow => ({
      kind: "click", selector: a.selector, description: a.description, line: a.selectorSpan.line,
    })),
    ...stp.highlights.map((a): ActionRow => ({
      kind: "highlight", selector: a.selector, description: a.description, line: a.selectorSpan.line,
    })),
    ...stp.cursors.map((a): ActionRow => ({
      kind: "cursor", selector: a.selector, description: a.description, line: a.selectorSpan.line,
    })),
    ...stp.types.map((t): ActionRow => ({
      kind: "type", text: t.text, line: t.span.line,
    })),
  ];
  return rows.sort((a, b) => a.line - b.line);
}

export function slug(input: string): string {
  const out = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out.length === 0 ? "untitled" : out;
}

export function emitManual(ast: DemoAst): ManualOutput {
  const warnings: ManualWarning[] = [];
  const lines: string[] = [];

  // ---- frontmatter ----
  lines.push(`# ${ast.frontmatter.title}`);
  lines.push("");
  if (ast.frontmatter.description) {
    lines.push(`*${ast.frontmatter.description}*`);
    lines.push("");
  }
  lines.push(`**URL:** ${ast.frontmatter.url}`);
  lines.push("");

  // ---- table of contents ----
  if (ast.scenes.length > 0) {
    lines.push("## Contents");
    lines.push("");
    ast.scenes.forEach((s, i) => {
      const n = i + 1;
      lines.push(`${n}. [${s.title}](#${n}-${slug(s.title)})`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // ---- scenes ----
  ast.scenes.forEach((s, i) => {
    const n = i + 1;
    lines.push(`## ${n}. ${s.title} <a id="${n}-${slug(s.title)}"></a>`);
    lines.push("");
    if (s.prose.trim()) {
      lines.push(s.prose.trim());
      lines.push("");
    }
    s.steps.forEach((stp, j) => renderStep(stp, n, j, lines, warnings));
  });

  return { markdown: lines.join("\n"), warnings };
}

function renderStep(
  stp: Step,
  sceneNum: number,
  stepIdx: number,
  out: string[],
  warnings: ManualWarning[],
): void {
  // Heading — only for explicit steps (stepIdx > 0 and a description set).
  if (stepIdx > 0 && stp.description) {
    out.push(`### ${sceneNum}.${stepIdx} ${stp.description}`);
    out.push("");
  }
  // Narration (fx.say) — first prose paragraph.
  if (stp.says.length > 0) {
    out.push(stp.says[0].text);
    out.push("");
  }
  if (stp.says.length === 0 && stp.banners.length > 0) {
    out.push(`**On-screen:** ${stp.banners[0].text}`);
    out.push("");
  }
  renderActions(stp, sceneNum, stepIdx, out, warnings);
}

function renderActions(stp: Step, _sceneNum: number, _stepIdx: number, out: string[], warnings: ManualWarning[]): void {
  const rows = actionsInSourceOrder(stp);
  // Fold: drop cursors whose selector also has a click in the same step.
  const clickSelectors = new Set(rows.filter((r) => r.kind === "click").map((r) => r.selector));
  const visible = rows.filter((r) => !(r.kind === "cursor" && clickSelectors.has(r.selector)));

  visible.forEach((r, idx) => {
    const n = idx + 1;
    let sentence = "";
    if (r.kind === "click") {
      sentence = `${n}. Click **${r.description}**.`;
    } else {
      return; // remaining kinds handled in later tasks
    }
    out.push(sentence);
  });
  if (visible.some((r) => r.kind === "click")) {
    out.push("");
  }
  void warnings; // unused until Task 11
}
