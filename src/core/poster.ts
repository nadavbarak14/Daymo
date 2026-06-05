import { execa } from "execa";

/** Extract a single poster frame (JPEG) from a video via ffmpeg. Best-effort:
 *  resolves `false` if ffmpeg is unavailable or the frame can't be grabbed,
 *  so callers can treat the poster as optional. Seeks `atSeconds` in to avoid
 *  a black/blank opening frame. */
export async function extractPoster(
  videoPath: string,
  posterPath: string,
  atSeconds = 0.5,
): Promise<boolean> {
  try {
    await execa("ffmpeg", [
      "-y",
      "-ss", String(atSeconds),
      "-i", videoPath,
      "-frames:v", "1",
      "-q:v", "3",
      posterPath,
    ]);
    return true;
  } catch {
    return false;
  }
}
