#!/usr/bin/env node
import { cac } from "cac";
import { renderCommand } from "./commands/render.js";

const cli = cac("daymo");

cli.command("render <file>", "Execute the demo and produce output.mp4")
  .option("--out <dir>", "Artifacts directory base", { default: "./artifacts" })
  .action((file: string, flags: { out: string }) =>
    renderCommand(file, { out: flags.out }),
  );

cli.help();
cli.version("0.1.0");
cli.parse(process.argv, { run: false });

(async () => {
  try {
    await cli.runMatchedCommand();
  } catch (e) {
    console.error(`daymo: ${(e as Error).message}`);
    process.exit(1);
  }
})();
