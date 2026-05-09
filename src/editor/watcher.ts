import chokidar, { type FSWatcher } from "chokidar";

export interface WatcherOpts {
  paths: string[];
  debounceMs?: number;
  onChange: (changedPath: string) => void;
}

export class Watcher {
  private fsw: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private suppressionCount = 0;
  constructor(private opts: WatcherOpts) {}

  async start(): Promise<void> {
    this.fsw = chokidar.watch(this.opts.paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 10 },
    });
    this.fsw.on("all", (_evt, p) => {
      if (this.suppressionCount > 0) {
        this.suppressionCount--;
        return;
      }
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.opts.onChange(p), this.opts.debounceMs ?? 100);
    });
    await new Promise<void>((res) => this.fsw!.once("ready", () => res()));
  }

  /** Tell the watcher to ignore the next event on these paths (used right before our own write). */
  suppressNext(count = 1): void {
    this.suppressionCount += count;
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.fsw?.close();
  }
}
