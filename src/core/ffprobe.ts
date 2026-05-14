import { execa } from "execa";

/** Invoke ffprobe to read the duration of a media file. Returns duration in
 *  milliseconds, rounded to the nearest integer. Throws with a clear message
 *  if ffprobe is missing, the file does not exist, or the duration cannot be
 *  parsed. */
export async function probeDurationMs(filePath: string): Promise<number> {
  try {
    const result = await execa("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const seconds = Number.parseFloat(result.stdout.trim());
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`ffprobe returned unparseable duration for ${filePath}: ${result.stdout}`);
    }
    return Math.round(seconds * 1000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ffprobe failed for ${filePath}: ${msg}`);
  }
}
