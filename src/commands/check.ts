// src/commands/check.ts
//
// `daymo check [path]` — discover .demo files, run each through checkDemo (no
// recording), print a report, and exit non-zero if any script no longer matches
// the UI. Designed to drop into a project's existing e2e CI job as a one-liner.
import path from "node:path";
import fs from "node:fs/promises";
import { findDemoFiles } from "../indexer/write-index.js";
import { checkDemo, type CheckResult } from "../core/check.js";

export interface CheckFlags {
  baseUrl?: string;
  timeout?: number;
  json?: boolean;
}

async function collectDemoFiles(target: string): Promise<string[]> {
  const stat = await fs.stat(target);
  if (stat.isFile()) {
    if (!target.endsWith(".demo")) throw new Error(`not a .demo file: ${target}`);
    return [target];
  }
  // findDemoFiles throws "no .demo files found in <dir>" on an empty dir, which
  // is the behavior we want (a misconfigured path should fail, not pass).
  return findDemoFiles(target);
}

function printReport(results: CheckResult[]): void {
  for (const r of results) {
    const secs = (r.durationMs / 1000).toFixed(1);
    if (r.ok) {
      process.stdout.write(`✓ ${r.demoId}  ${r.steps.length} steps  ${secs}s\n`);
      continue;
    }
    const f = r.failure!;
    const stepLabel = f.step ? ` step ${f.step.stepIndex} "${f.step.label}"` : "";
    process.stdout.write(`✗ ${r.demoId}${stepLabel}\n`);
    process.stdout.write(`    ${f.selector ? `selector not found: ${f.selector}` : f.message}\n`);
    const loc = path.relative(process.cwd(), f.file) + (f.line ? `:${f.line}` : "");
    process.stdout.write(`    ${loc}\n`);
  }
  const broken = results.filter((r) => !r.ok).length;
  process.stdout.write(
    broken > 0
      ? `\n${broken} of ${results.length} demos broken → exit 1\n`
      : `\nall ${results.length} demos ok\n`,
  );
}

export async function checkCommand(target: string, flags: CheckFlags): Promise<void> {
  const demoFiles = await collectDemoFiles(path.resolve(target));
  const results: CheckResult[] = [];
  // Sequential: a shared seeded app is stateful, so parallel demos would race.
  for (const file of demoFiles) {
    results.push(await checkDemo(file, { baseUrl: flags.baseUrl, timeoutMs: flags.timeout }));
  }

  if (flags.json) {
    process.stdout.write(
      JSON.stringify({ ok: results.every((r) => r.ok), demos: results }, null, 2) + "\n",
    );
  } else {
    printReport(results);
  }

  if (!results.every((r) => r.ok)) process.exitCode = 1;
}
