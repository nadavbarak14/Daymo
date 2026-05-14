import type { DemoAst } from "../types.js";

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
    s.steps.forEach((stp, j) => {
      if (j > 0 && stp.description) {
        // Step index: explicit steps are numbered 1.1, 1.2, ... starting from
        // the first explicit step (j === 1 in the AST since steps[0] is the
        // implicit preamble).
        lines.push(`### ${n}.${j} ${stp.description}`);
        lines.push("");
      }
    });
  });

  return { markdown: lines.join("\n"), warnings };
}
