import { kv } from "@vercel/kv";

export async function checkRateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter?: number }> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const count = await kv.incr(bucket);
  if (count === 1) await kv.expire(bucket, windowSec);
  if (count > limit) return { ok: false, retryAfter: windowSec };
  return { ok: true };
}
