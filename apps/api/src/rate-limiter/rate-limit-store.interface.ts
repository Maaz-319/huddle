/**
 * One attempt to spend from a bucket.
 *
 * The bucket holds at most `capacity` tokens and gains `refillPerSecond` of
 * them back over time. Every field is supplied by the caller — the store knows
 * nothing about policies, routes, users, or addresses. That is what lets the
 * same primitive serve the REST guard and, in Phase 8, the WS gateway.
 */
export interface RateLimitRequest {
  /**
   * The bucket to spend from, e.g. `huddle:rl:message-send:channel:8901234567890123`.
   *
   * The store never builds one: it is handed a key
   * (docs/architecture/rate-limiter.md section 2 owns the scheme).
   */
  key: string;

  /** The bucket's ceiling, and the largest burst it can absorb at once. */
  capacity: number;

  /**
   * Tokens returned per second, up to `capacity`. Must be greater than zero —
   * a bucket that never refills has no expiry to compute and no answer to give
   * for how long to wait.
   */
  refillPerSecond: number;

  /** How many tokens this attempt costs. Usually 1. */
  cost: number;

  /**
   * The current time, in epoch milliseconds.
   *
   * Passed in rather than read inside the store, deliberately. It buys two
   * things: the shared contract suite can advance time by arithmetic instead of
   * sleeping through it, so the *same* assertions run against the fake and
   * against real Redis; and refill becomes testable at all without a
   * `setTimeout` per case.
   *
   * The trade is that two app instances with skewed clocks would corrupt a
   * shared bucket — a non-issue at Huddle's single-instance scale
   * (docs/architecture/rate-limiter.md section 1). If Huddle ever runs more than
   * one instance, the fix is for the Lua script to take the time from
   * `redis.call('TIME')` instead, which makes Redis the single clock.
   */
  nowMs: number;
}

/** What the bucket had to say about the attempt. */
export interface RateLimitResult {
  /** Whether the tokens were actually spent. */
  allowed: boolean;

  /** Whole tokens left afterwards. Rounded down: a partial token buys nothing. */
  remaining: number;

  /**
   * How long until the bucket holds `cost` tokens again. `0` when allowed.
   *
   * Milliseconds, because Phase 8's WS path sends the raw value back in a
   * `connect_error` payload. The REST path rounds it *up* to whole seconds for
   * the `Retry-After` header, which HTTP requires
   * (docs/architecture/rate-limiter.md section 6).
   */
  retryAfterMs: number;
}

/**
 * The token bucket, and the only place in Huddle that does bucket maths.
 *
 * Everything that limits anything calls this: the REST guard, and in Phase 8
 * the per-event and per-connection WS checks. A token bucket rather than a
 * fixed-window counter because bursts must be allowed while sustained abuse is
 * not — pasting five messages quickly is fine, a flood is not
 * (docs/architecture/tech-stack.md section 7, which rejects `@nestjs/throttler`
 * for exactly this reason).
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and an interface is erased at compile time, so
 * `{ provide: RateLimitStore, ... }` would be `provide: undefined`. That fails
 * at boot, not at compile time. See docs/architecture/repo-structure.md
 * section 3.
 */
export abstract class RateLimitStore {
  /**
   * Takes `cost` tokens from the bucket at `key`, if it has them.
   *
   * Atomic: two concurrent calls can never both spend the same last token. An
   * implementation that reads, decides, then writes is wrong, however narrow
   * the window looks.
   *
   * A bucket that does not exist is a full one, so a lost or expired bucket
   * fails open rather than locking someone out
   * (docs/architecture/rate-limiter.md section 2).
   */
  abstract consume(request: RateLimitRequest): Promise<RateLimitResult>;
}
