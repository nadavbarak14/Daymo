import path from "node:path";
import { composeFromBundle } from "../runner.js";

export async function composeCommand(
  bundle: string,
  file: string | undefined,
  _flags: Record<string, unknown>,
): Promise<void> {
  const bundleDir = path.resolve(bundle);
  const override = file ? path.resolve(file) : undefined;
  console.log(`daymo: composing from ${bundleDir}${override ? ` (using ${override})` : ""}`);
  const { mp4Path } = await composeFromBundle({ bundleDir, demoFileOverride: override });
  console.log(`daymo: wrote ${mp4Path}`);
}
