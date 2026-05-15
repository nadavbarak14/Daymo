export interface SayEventForVtt {
  /** Global ms from start of the stitched mp4. */
  globalStartMs: number;
  durationMs: number;
  text: string;
}

function formatTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
}

export function buildWebVtt(says: SayEventForVtt[]): string {
  let out = "WEBVTT\n\n";
  for (const s of says) {
    const start = formatTimestamp(s.globalStartMs);
    const end = formatTimestamp(s.globalStartMs + s.durationMs);
    out += `${start} --> ${end}\n${s.text}\n\n`;
  }
  return out;
}
