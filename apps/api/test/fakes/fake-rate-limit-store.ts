import {
  RateLimitRequest,
  RateLimitResult,
  RateLimitStore,
} from '../../src/rate-limiter/rate-limit-store.interface';

/** What one bucket remembers between calls, mirroring the Redis hash. */
interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * In-memory `RateLimitStore`, for unit tests of everything that will depend on
 * the port — the budgets and dimension keys, the REST guard, and Phase 8's WS
 * checks — without needing Docker.
 *
 * `extends RateLimitStore` rather than duck-typing it: adding a method to the
 * port then breaks compilation here, which is the only thing keeping a fake
 * honest as the port grows.
 *
 * The arithmetic below is deliberately the *same* arithmetic as the Lua script,
 * step for step, including the fractional token count and the rounding down of
 * `remaining`. Both run on IEEE doubles, so they agree exactly. A fake that
 * rounded differently would make the shared contract true of one implementation
 * and false of the other, which is the failure mode the contract exists to
 * prevent.
 *
 * What it does *not* model is expiry: a bucket here lives until the fake is
 * thrown away. TTL is a Redis behaviour and is asserted against real Redis in
 * the adapter's integration spec.
 */
export class FakeRateLimitStore extends RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  consume(request: RateLimitRequest): Promise<RateLimitResult> {
    const { key, capacity, refillPerSecond, cost, nowMs } = request;
    const existing = this.buckets.get(key);

    // An absent bucket is a full one, matching the script.
    let tokens = existing === undefined ? capacity : existing.tokens;
    const updatedAt = existing === undefined ? nowMs : existing.updatedAt;

    tokens = Math.min(
      capacity,
      tokens + ((nowMs - updatedAt) / 1000) * refillPerSecond,
    );

    const allowed = tokens >= cost;
    if (allowed) tokens -= cost;

    this.buckets.set(key, { tokens, updatedAt: nowMs });

    return Promise.resolve({
      allowed,
      remaining: Math.floor(tokens),
      retryAfterMs: allowed
        ? 0
        : Math.ceil(((cost - tokens) / refillPerSecond) * 1000),
    });
  }
}
