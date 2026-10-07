/**
 * The named budgets from docs/architecture/rate-limiter.md section 4, and the
 * dimension each one keys on from section 3.
 *
 * Section 4 calls these "starting budgets, tunable", so they live here as named
 * constants rather than as magic numbers at call sites: retuning `message-send`
 * is a one-line edit in one file, not a search across controllers and gateways.
 *
 * This file is now the live source for those numbers; the doc's table records
 * the reasoning behind them.
 */

/**
 * The three dimensions section 3 allows, and no others. A fourth would be a
 * change to the design doc first.
 */
export type RateLimitDimension = 'user' | 'ip' | 'channel';

/** One route class's budget. */
export interface RateLimitPolicy {
  /** The bucket's ceiling, and the largest burst it absorbs at once. */
  capacity: number;

  /** Tokens returned per second. Capacity divided by this is a full refill. */
  refillPerSecond: number;

  /** What the bucket is keyed on. */
  dimension: RateLimitDimension;
}

/** Five tokens a minute, expressed the way the buckets want it. */
const PER_MINUTE = (n: number): number => n / 60;

/**
 * `as const satisfies` rather than a plain `: Record<string, RateLimitPolicy>`
 * annotation, deliberately. The annotation alone widens `keyof` to `string`,
 * and `@RateLimit('mesage-send')` would then compile and run unlimited. This
 * way each entry is still checked against `RateLimitPolicy`, but the key type
 * stays the literal union below.
 */
export const RATE_LIMIT_POLICIES = {
  /** Section 4, "Message send": ~5 tokens burst, refill ~1/sec. */
  'message-send': { capacity: 5, refillPerSecond: 1, dimension: 'channel' },

  /**
   * Section 4, "Typing indicator": a cheap bucket. Roomy enough that a fast
   * typist never sees it, tight enough to cap a script. The server-side
   * debounce (chat-service.md section 7) now lives in ChatGateway's typing
   * handler — this is the ceiling *behind* it: only frames the debounce let
   * through reach this bucket, so it caps the aggregate flood across everyone
   * typing in the channel rather than counting keystrokes.
   */
  typing: { capacity: 10, refillPerSecond: 2, dimension: 'channel' },

  /**
   * Section 4, "Login / OAuth callback (per-IP)": strict, 5/min. Per-IP because
   * there is no user id yet on a pre-auth route — that is the case section 3
   * introduces the IP dimension for.
   */
  'auth-ip': { capacity: 5, refillPerSecond: PER_MINUTE(5), dimension: 'ip' },

  /** Section 4, "Invite regenerate, role promotion": strict, 3/min. */
  'strict-mutation': {
    capacity: 3,
    refillPerSecond: PER_MINUTE(3),
    dimension: 'user',
  },

  /**
   * Section 4, "Reads (history, Open GET points)": generous. Sixty in a burst,
   * sustaining sixty a minute — enough to page back through history quickly
   * without being a cap a person can reach by hand.
   */
  read: { capacity: 60, refillPerSecond: 1, dimension: 'user' },

  /**
   * Section 4, "WS connection attempts (per-IP)": ~5 attempts/min.
   *
   * Defined here and consumed in Phase 8, which is intended rather than dead
   * code: section 3 lists WS connection attempts as one of the three per-IP
   * cases, and a budget belongs with its siblings rather than appearing alone
   * six phases later.
   */
  'ws-connect': {
    capacity: 5,
    refillPerSecond: PER_MINUTE(5),
    dimension: 'ip',
  },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * The names a caller may limit against. This is the type `@RateLimit(...)`
 * takes, which is what turns a mistyped policy into a build error instead of a
 * silently unlimited route.
 */
export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
