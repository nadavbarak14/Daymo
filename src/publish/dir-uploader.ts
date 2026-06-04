import fs from "node:fs/promises";
import path from "node:path";
import type { Uploader } from "./types.js";

/** Default Uploader: writes artifacts to a local output directory. An S3/R2
 *  uploader implements the same interface and drops in unchanged. */
export function createDirUploader(outDir: string): Uploader {
  return {
    async put(key, body, _contentType): Promise<void> {
      const dest = path.join(outDir, key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, typeof body === "string" ? body : Buffer.from(body));
    },
  };
}
