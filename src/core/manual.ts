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

export function emitManual(_ast: DemoAst): ManualOutput {
  return { markdown: "", warnings: [] };
}
