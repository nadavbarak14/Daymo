export interface RateLimiterOpts {
  maxPerMinute: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSec: number;
}

interface Bucket {
  windowStartMs: number;
  count: number;
}

export function createRateLimiter(opts: RateLimiterOpts): {
  check(key: string): RateLimitDecision;
} {
  const buckets = new Map<string, Bucket>();
  const windowMs = 60_000;
  return {
    check(key: string): RateLimitDecision {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || now - b.windowStartMs >= windowMs) {
        b = { windowStartMs: now, count: 0 };
        buckets.set(key, b);
      }
      if (b.count >= opts.maxPerMinute) {
        const elapsed = now - b.windowStartMs;
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)) };
      }
      b.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}
