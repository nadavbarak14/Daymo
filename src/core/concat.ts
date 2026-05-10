export function buildConcatList(scenePaths: string[]): string {
  return scenePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

export interface BuildStitchArgsOpts {
  listFile: string;
  music: string | null;
  output: string;
  musicVolume?: number;
  musicDuck?: boolean;
}

export function buildStitchArgs(opts: BuildStitchArgsOpts): string[] {
  const argv: string[] = ["-y", "-f", "concat", "-safe", "0", "-i", opts.listFile];
  if (opts.music) {
    const vol = (opts.musicVolume ?? 0.4).toFixed(1);
    if (opts.musicDuck) {
      argv.push(
        "-i", opts.music,
        "-filter_complex",
        `[1:a]volume=${vol}[bg];[bg][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=250[ducked];[ducked][0:a]amix=inputs=2:duration=first[final]`,
        "-map", "0:v",
        "-map", "[final]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-shortest",
        opts.output,
      );
    } else {
      argv.push(
        "-i", opts.music,
        "-filter_complex", `[1:a]volume=${vol}[m]`,
        "-map", "0:v",
        "-map", "[m]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-shortest",
        opts.output,
      );
    }
  } else {
    // No bg music: passthrough scene audio (if any) and re-encode video to h264.
    // Use ? on the audio map so concat without audio streams still works.
    argv.push(
      "-map", "0:v",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-c:a", "aac",
      opts.output,
    );
  }
  return argv;
}
