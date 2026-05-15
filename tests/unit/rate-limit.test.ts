import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../../src/chat-server/rate-limit.js";

describe("rate limiter", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-14T00:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows up to N requests per window per key", () => {
    const rl = createRateLimiter({ maxPerMinute: 3 });
    expect(rl.check("k1").allowed).toBe(true);
    expect(rl.check("k1").allowed).toBe(true);
    expect(rl.check("k1").allowed).toBe(true);
    const fourth = rl.check("k1");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
  });

  it("separates buckets per key", () => {
    const rl = createRateLimiter({ maxPerMinute: 1 });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("b").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(false);
  });

  it("refills after the window elapses", () => {
    const rl = createRateLimiter({ maxPerMinute: 1 });
    expect(rl.check("k").allowed).toBe(true);
    expect(rl.check("k").allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(rl.check("k").allowed).toBe(true);
  });
});
