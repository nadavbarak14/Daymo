import { captureSingleScene } from "../single-capture.js";
import type { DemoAst } from "../types.js";
import type { SseBus } from "./sse.js";

export interface CaptureQueueOpts {
  getAst: () => DemoAst;
  capturesDir: string;
  demoFile: string;
  sse: SseBus;
  onDone: (sceneIndex: number, webm: string, events: string) => void;
  onError: (sceneIndex: number, message: string) => void;
}

export class CaptureQueue {
  private running = false;
  private q: number[] = [];
  private idleResolvers: Array<() => void> = [];
  constructor(private opts: CaptureQueueOpts) {}

  enqueue(sceneIndex: number): void {
    this.q.push(sceneIndex);
    if (!this.running) void this.drain();
  }

  /** Resolves when the queue is empty (and any in-flight capture has finished). */
  whenIdle(): Promise<void> {
    if (!this.running && this.q.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.q.length) {
      const i = this.q.shift()!;
      this.opts.sse.publish({ type: "capture-start", sceneIndex: i });
      try {
        const out = await captureSingleScene(this.opts.getAst(), i, {
          capturesDir: this.opts.capturesDir,
          demoFile: this.opts.demoFile,
        });
        this.opts.onDone(i, out.webm, out.events);
        this.opts.sse.publish({ type: "capture-done", sceneIndex: i, webmPath: out.webm });
      } catch (e) {
        const msg = (e as Error).message;
        this.opts.onError(i, msg);
        this.opts.sse.publish({ type: "capture-error", sceneIndex: i, message: msg });
      }
    }
    this.running = false;
    const resolvers = this.idleResolvers.splice(0);
    for (const r of resolvers) r();
  }
}
