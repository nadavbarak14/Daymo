// src/commands/doctor.ts
import { execa } from "execa";
import { chromium } from "playwright";

interface Check { name: string; ok: boolean; detail?: string }

export async function doctorCommand(): Promise<void> {
  const checks: Check[] = [];

  try {
    const r = await execa("ffmpeg", ["-version"]);
    checks.push({ name: "ffmpeg", ok: true, detail: r.stdout.split("\n")[0] });
  } catch {
    checks.push({ name: "ffmpeg", ok: false, detail: "not found in PATH — install via brew/apt and retry" });
  }

  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    checks.push({ name: "playwright chromium", ok: true });
  } catch (e) {
    checks.push({
      name: "playwright chromium",
      ok: false,
      detail: `Chromium failed to launch — try \`npx playwright install chromium\`. (${(e as Error).message})`,
    });
  }

  let allOk = true;
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    console.log(`  ${mark} ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
    allOk = allOk && c.ok;
  }
  if (!allOk) process.exit(1);
}
