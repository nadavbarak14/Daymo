import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { Watcher } from "../../src/editor/watcher.js";

describe("Watcher", () => {
  it("fires once per debounced burst, ignores self-writes", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "daymo-watch-"));
    const f = path.join(tmp, "demo.demo");
    await fs.writeFile(f, "x");

    const onChange = vi.fn();
    const w = new Watcher({ paths: [f], debounceMs: 50, onChange });
    await w.start();

    w.suppressNext();
    await fs.writeFile(f, "y"); // should be suppressed
    await new Promise((r) => setTimeout(r, 80));
    expect(onChange).not.toHaveBeenCalled();

    await fs.writeFile(f, "z"); // real edit
    await fs.writeFile(f, "z2");
    await new Promise((r) => setTimeout(r, 200));
    expect(onChange).toHaveBeenCalledTimes(1);

    await w.stop();
  }, 5_000);
});
