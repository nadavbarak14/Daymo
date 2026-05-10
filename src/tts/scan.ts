// src/tts/scan.ts
import ts from "typescript";

export interface FxSayCall {
  text: string;
  line: number; // 1-based, relative to the playwright code block
}

export function scanFxSayLiterals(code: string): FxSayCall[] {
  const sf = ts.createSourceFile("scene.ts", code, ts.ScriptTarget.ES2022, /*setParentNodes*/ true);
  const calls: FxSayCall[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "fx" &&
        callee.name.text === "say"
      ) {
        const arg = node.arguments[0];
        if (!arg) {
          throw new Error(`fx.say requires a string literal argument: <empty> at line ${lineOf(node)}`);
        }
        if (!ts.isStringLiteral(arg) && !ts.isNoSubstitutionTemplateLiteral(arg)) {
          const excerpt = code.slice(node.getStart(sf), Math.min(code.length, node.getStart(sf) + 80));
          throw new Error(`fx.say requires a string literal: line ${lineOf(node)} "${excerpt.replace(/\n/g, " ")}"`);
        }
        calls.push({ text: arg.text, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, visit);
  }
  function lineOf(node: ts.Node): number {
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  }

  visit(sf);
  return calls;
}
