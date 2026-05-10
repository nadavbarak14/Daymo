import path from "node:path";
import url from "node:url";
import { execa } from "execa";
import { startEditor } from "../editor/index.js";

export async function editCommand(
  file: string,
  opts: { port?: number; noOpen?: boolean } = {},
): Promise<void> {
  const demoFile = path.resolve(file);
  // dist/commands/edit.js is the runtime path; dist/editor-ui/ is one level up.
  const uiDir = path.resolve(url.fileURLToPath(new URL("../editor-ui", import.meta.url)));
  const h = await startEditor({
    demoFile,
    port: opts.port ?? 0,
    uiDir,
  });
  console.log(`daymo edit: ${h.url}`);

  if (!opts.noOpen) {
    const opener =
      process.platform === "darwin" ? "open" :
      process.platform === "win32" ? "start" : "xdg-open";
    void execa(opener, [h.url]).catch(() => {});
  }

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
  await h.stop();
}
