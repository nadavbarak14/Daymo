export function buildConcatList(scenePaths: string[]): string {
  return scenePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

export interface BuildStitchArgsOpts {
  listFile: string;
  music: string | null;
  output: string;
  musicVolume?: number;
}

export function buildStitchArgs(opts: BuildStitchArgsOpts): string[] {
  const argv: string[] = ["-y", "-f", "concat", "-safe", "0", "-i", opts.listFile];
  if (opts.music) {
    const vol = (opts.musicVolume ?? 0.4).toFixed(1);
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
  } else {
    argv.push("-an", "-c:v", "libx264", opts.output);
  }
  return argv;
}
