import path from "node:path";
import { capture } from "../runner.js";

export async function captureCommand(
  file: string,
  flags: { out?: string; scene?: string; bundle?: string },
): Promise<void> {
  const demoFile = path.resolve(file);
  const onlyScene = flags.scene !== undefined ? Number(flags.scene) : undefined;
  if (onlyScene !== undefined && (!Number.isInteger(onlyScene) || onlyScene < 0)) {
    throw new Error(`--scene must be a non-negative integer (got "${flags.scene}")`);
  }
  console.log(`daymo: capturing ${demoFile}${onlyScene !== undefined ? ` (scene ${onlyScene})` : ""}`);
  const { artifactsDir } = await capture({
    demoFile,
    artifactsBase: flags.out,
    onlyScene,
    bundleDir: flags.bundle ? path.resolve(flags.bundle) : undefined,
  });
  console.log(`daymo: bundle in ${artifactsDir}`);
}
