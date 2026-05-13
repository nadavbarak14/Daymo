// src/tts/scan.ts
import ts from "typescript";

export interface FxSayCall {
  text: string;
  line: number; // 1-based, relative to the playwright code block
}

export type FxLiteralKind = "step" | "say" | "banner" | "type" | "highlight" | "click" | "cursor";

export interface LiteralSpan {
  start: number; // file-absolute byte offset of the opening quote
  end: number;   // exclusive
  line: number;  // 1-based, file-relative
}

export interface FxLiteralEvent {
  kind: FxLiteralKind;
  text: string;
  span: LiteralSpan;
  /** Present for action-style calls (highlight/click/cursor) — the human
   *  description literal at argIndex 1. */
  description?: string;
  descriptionSpan?: LiteralSpan;
}

/**
 * Walk JS source for top-level fx.{step,say,banner,typeWithDelay} calls and
 * return them in source order. The relevant string argument of each call must
 * be a string literal or the walker throws with a precise error.
 *
 * For typeWithDelay, the *second* argument (the text) is what's captured.
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

  /** Action-style calls have a (selector, description, opts?) shape — we
   *  capture both the selector and the description literal. */
  const ACTION_KINDS: Record<string, FxLiteralKind> = {
    highlight: "highlight",
    click: "click",
    cursorTo: "cursor",
  };

  function isFxCall(node: ts.Node): { kind: FxLiteralKind; argIndex: number; descIndex?: number } | null {
    if (!ts.isCallExpression(node)) return null;
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee)) return null;
    if (!ts.isIdentifier(callee.expression)) return null;
    const obj = callee.expression.text;
    const name = callee.name.text;
    if (obj === "fx") {
      if (name === "step" || name === "say" || name === "banner") return { kind: name, argIndex: 0 };
      if (name in ACTION_KINDS) return { kind: ACTION_KINDS[name], argIndex: 0, descIndex: 1 };
      if (name === "typeWithDelay") return { kind: "type", argIndex: 1 };
    }
    // page.click is a Playwright primitive (no description). Track it anyway
    // so the rail still shows "what does this step click".
    if (obj === "page" && name === "click") return { kind: "click", argIndex: 0 };
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
      const arg = call.arguments[tag.argIndex];
      const methodLabel = tag.kind === "type" ? "typeWithDelay" : tag.kind;
      if (!arg) {
        // For typeWithDelay missing the text arg, ignore rather than throw — the
        // runtime would already fail and we don't want to block parsing on a
        // non-fatal authoring slip in the editor.
        if (tag.kind === "type") { ts.forEachChild(node, visit); return; }
        throw new Error(`fx.${methodLabel} requires a string literal argument: <empty> at line ${fileLineOf(call)}`);
      }
      if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
        // typeWithDelay with a dynamic text arg is uncommon but allowed at
        // runtime; we just skip it for the literal index instead of throwing.
        if (tag.kind === "type") { ts.forEachChild(node, visit); return; }
        const excerpt = code.slice(call.getStart(sf), Math.min(code.length, call.getStart(sf) + 80));
        throw new Error(
          `fx.${methodLabel} requires a string literal: line ${fileLineOf(call)} "${excerpt.replace(/\n/g, " ")}"`,
        );
      }
      // arg.getStart(sf) points at the opening quote of the literal.
      const argStart = arg.getStart(sf);
      const argEnd = arg.getEnd();
      const event: FxLiteralEvent = {
        kind: tag.kind,
        text: arg.text,
        span: {
          start: fenceStartOffset + argStart,
          end: fenceStartOffset + argEnd,
          line: fileLineOf(arg),
        },
      };
      // Action calls (highlight/click/cursor) — capture the description arg
      // at descIndex. Required for fx.* variants; throws if missing.
      if (tag.descIndex !== undefined) {
        const descArg = call.arguments[tag.descIndex];
        if (descArg && (ts.isStringLiteral(descArg) || ts.isNoSubstitutionTemplateLiteral(descArg))) {
          event.description = descArg.text;
          event.descriptionSpan = {
            start: fenceStartOffset + descArg.getStart(sf),
            end: fenceStartOffset + descArg.getEnd(),
            line: fileLineOf(descArg),
          };
        } else {
          // Only the fx.* variants require a description literal; page.click
          // (no descIndex set) is allowed without one.
          throw new Error(
            `fx.${methodLabel} requires a description string as the 2nd arg: line ${fileLineOf(call)}`,
          );
        }
      }
      out.push(event);
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
