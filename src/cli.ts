#!/usr/bin/env node
import { cac } from "cac";
import { renderCommand } from "./commands/render.js";
import { doctorCommand } from "./commands/doctor.js";
import { editCommand } from "./commands/edit.js";
import { stateCommand } from "./commands/state.js";

const cli = cac("daymo");

cli.command("render <file>", "Execute the demo and produce output.mp4")
  .option("--out <dir>", "Artifacts directory base", { default: "./artifacts" })
  .action((file: string, flags: { out: string }) =>
    renderCommand(file, { out: flags.out }),
  );

cli.command("doctor", "Verify Playwright and ffmpeg are configured")
  .action(() => doctorCommand());

cli.command("edit <file>", "Open the visual editor for a .demo file")
  .option("--port <n>", "Port to bind on localhost", { default: 0 })
  .option("--no-open", "Do not open a browser tab")
  .action((file: string, flags: { port: number; noOpen: boolean }) =>
    editCommand(file, { port: flags.port, noOpen: flags.noOpen }),
  );

cli.command("state <file>", "Print scene state table")
  .option("--json", "Emit raw JSON state")
  .action((file: string, flags: { json: boolean }) =>
    stateCommand(file, { json: flags.json }),
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
