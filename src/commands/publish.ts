import path from "node:path";
import os from "node:os";
import { publish } from "../publish/publish.js";
import { createDirUploader } from "../publish/dir-uploader.js";

export interface PublishCommandOpts {
  widgetId: string;
  out: string;
  version?: string;
  dataRoot?: string;
}

export async function publishCommand(opts: PublishCommandOpts): Promise<void> {
  const dataRoot = opts.dataRoot ?? process.env.DAYMO_DATA_ROOT ?? path.join(os.homedir(), ".daymo-chat-data");
  const version = opts.version ?? "v1";
  const uploader = createDirUploader(opts.out);

  const summary = await publish({
    dataRoot,
    widgetId: opts.widgetId,
    version,
    uploader,
    log: (msg) => process.stdout.write(`${msg}\n`),
  });

  process.stdout.write(`daymo publish: ${summary.videoCount} video(s) → ${opts.out}\n`);
  if (summary.missingVideos.length > 0) {
    process.stdout.write(`  missing videos (run \`daymo render\` first): ${summary.missingVideos.join(", ")}\n`);
  }
}
