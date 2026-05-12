// src/tts/scan.ts
import ts from "typescript";

export interface FxSayCall {
  text: string;
  line: number; // 1-based, relative to the playwright code block
}

export type FxLiteralKind = "step" | "say" | "banner";

export interface FxLiteralEvent {
  kind: FxLiteralKind;
  text: string;
  span: {
    start: number; // file-absolute byte offset of the opening quote
    end: number;   // exclusive
    line: number;  // 1-based, file-relative
  };
}

/**
 * Walk JS source for top-level fx.{step,say,banner} calls and return them in
 * source order. The first argument of each call must be a string literal or
 * the walker throws with a precise error.
 *
 * `fenceStartOffset` is the byte offset of `code` within the containing .demo
 * file (so callers get file-absolute spans without bookkeeping).
 *
 * `fenceStartLine` is the 1-based file line of the first line of `code`.
 */
export function scanStepEvents(
  code: string,
  fenceStartOffset: number,
  fenceStartLine: number,
): FxLiteralEvent[] {
  const sf = ts.createSourceFile("scene.ts", code, ts.ScriptTarget.ES2022, /*setParentNodes*/ true);
  const out: FxLiteralEvent[] = [];

  function isFxCall(node: ts.Node): { kind: FxLiteralKind } | null {
    if (!ts.isCallExpression(node)) return null;
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee)) return null;
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "fx") return null;
    const name = callee.name.text;
    if (name === "step" || name === "say" || name === "banner") return { kind: name };
    return null;
  }

  function fileLineOf(node: ts.Node): number {
    // ts line is 0-based, file line is 1-based; offset by fenceStartLine - 1.
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + fenceStartLine;
  }

  function visit(node: ts.Node): void {
    const tag = isFxCall(node);
    if (tag) {
      const call = node as ts.CallExpression;
      const arg = call.arguments[0];
      if (!arg) {
        throw new Error(`fx.${tag.kind} requires a string literal argument: <empty> at line ${fileLineOf(call)}`);
      }
      if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
        const excerpt = code.slice(call.getStart(sf), Math.min(code.length, call.getStart(sf) + 80));
        throw new Error(
          `fx.${tag.kind} requires a string literal: line ${fileLineOf(call)} "${excerpt.replace(/\n/g, " ")}"`,
        );
      }
      // arg.getStart(sf) points at the opening quote of the literal.
      const argStart = arg.getStart(sf);
      const argEnd = arg.getEnd();
      out.push({
        kind: tag.kind,
        text: arg.text,
        span: {
          start: fenceStartOffset + argStart,
          end: fenceStartOffset + argEnd,
          line: fileLineOf(arg),
        },
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return out;
}

/**
 * Back-compat shim: existing callers (TTS pre-synthesis) only need say literals
 * and use code-relative line numbers. Implemented on top of scanStepEvents.
 */
export function scanFxSayLiterals(code: string): FxSayCall[] {
  return scanStepEvents(code, 0, 1)
    .filter((e) => e.kind === "say")
    .map((e) => ({ text: e.text, line: e.span.line }));
}
