#!/usr/bin/env node
import { cac } from "cac";
import { renderCommand } from "./commands/render.js";
import { doctorCommand } from "./commands/doctor.js";
import { editCommand } from "./commands/edit.js";
import { stateCommand } from "./commands/state.js";
import { captureCommand } from "./commands/capture.js";
import { stitchCommand } from "./commands/stitch.js";
import { setProseCommand } from "./commands/set-prose.js";
import { migrateProseCommand } from "./commands/migrate-prose.js";

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

cli.command("capture <file>", "Capture one scene (--scene N) or all scenes (--all)")
  .option("--scene <n>", "Scene index, 1-based")
  .option("--all", "Capture every scene")
  .action((file: string, flags: { scene?: string; all?: boolean }) =>
    captureCommand(file, {
      scene: flags.scene !== undefined ? Number(flags.scene) : undefined,
      all: !!flags.all,
    }),
  );

cli.command("stitch <file>", "Compose all captured scenes into output.mp4")
  .action((file: string) => stitchCommand(file));

cli.command("set-prose <file>", "Rewrite a scene's prose markdown")
  .option("--scene <n>", "Scene index, 1-based")
  .option("--text <txt>", "New prose")
  .action((file: string, flags: { scene: string; text: string }) => {
    if (!flags.scene || flags.text === undefined) throw new Error("--scene and --text are required");
    return setProseCommand(file, { scene: Number(flags.scene), text: flags.text });
  });

cli.command("migrate-prose <file>", "Wrap each scene's prose into fx.say() and remove from markdown body")
  .action((file: string) => migrateProseCommand(file));

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
