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

  lines.push(`# ${ast.frontmatter.title}`);
  lines.push("");
  if (ast.frontmatter.description) {
    lines.push(`*${ast.frontmatter.description}*`);
    lines.push("");
  }
  lines.push(`**URL:** ${ast.frontmatter.url}`);
  lines.push("");

  return { markdown: lines.join("\n"), warnings };
}
