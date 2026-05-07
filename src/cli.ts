#!/usr/bin/env node
import { cac } from "cac";
import { renderCommand } from "./commands/render.js";
import { doctorCommand } from "./commands/doctor.js";
import { captureCommand } from "./commands/capture.js";
import { composeCommand } from "./commands/compose.js";

const cli = cac("daymo");

cli.command("render <file>", "Execute the demo and produce output.mp4")
  .option("--out <dir>", "Artifacts directory base", { default: "./artifacts" })
  .action((file: string, flags: { out: string }) =>
    renderCommand(file, { out: flags.out }),
  );

cli.command("capture <file>", "Run the demo and write an artifact bundle")
  .option("--out <dir>", "Artifacts directory base", { default: "./artifacts" })
  .option("--scene <n>", "Re-shoot a single scene (per-scene mode only)")
  .option("--bundle <dir>", "Existing bundle to update (per-scene mode only)")
  .action((file: string, flags: { out: string; scene?: string; bundle?: string }) =>
    captureCommand(file, flags));

cli.command("compose <bundle> [file]", "Compose output.mp4 from an artifact bundle")
  .action((bundle: string, file: string | undefined, flags: Record<string, unknown>) =>
    composeCommand(bundle, file, flags));

cli.command("doctor", "Verify Playwright and ffmpeg are configured")
  .action(() => doctorCommand());

cli.help();
cli.version("0.2.0");
cli.parse(process.argv, { run: false });

(async () => {
  try {
    await cli.runMatchedCommand();
  } catch (e) {
    console.error(`daymo: ${(e as Error).message}`);
    process.exit(1);
  }
})();
