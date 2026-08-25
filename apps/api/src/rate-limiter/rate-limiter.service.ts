import { Injectable } from '@nestjs/common';
import { buildRateLimitKey, RateLimitContext } from './rate-limit-key';
import {
  RATE_LIMIT_POLICIES,
  RateLimitPolicyName,
} from './rate-limit-policies';
import { RateLimitResult, RateLimitStore } from './rate-limit-store.interface';

/** A store result, plus the ceiling it was measured against. */
export interface RateLimitDecision extends RateLimitResult {
  /**
   * The policy's capacity. It rides along because the REST guard reports it as
   * `X-RateLimit-Limit` on every rate-limited response
   * (docs/architecture/rate-limiter.md section 6), and should not have to open
   * the policy table a second time to find it.
   */
  limit: number;
}

/**
 * The layer between "this route is limited by policy X" and the token bucket.
 *
 * Everything that limits anything calls this: the REST guard, and in Phase 8
 * the per-event and per-connection WS checks. It holds the composition and
 * nothing else — look the policy up, build the key, read the clock, spend the
 * tokens.
 *
 * It injects only `RateLimitStore`. No `RedisService`, no `PrismaService`, no
 * third-party client: this is a `*.service.ts`, and if it looked like it needed
 * one the port would be missing a method (AGENTS.md section 2).
 */
@Injectable()
export class RateLimiterService {
  constructor(private readonly store: RateLimitStore) {}

  /**
   * Spends `cost` tokens from the bucket `policy` puts this caller in.
   *
   * Returns the decision rather than throwing on rejection. Turning a refusal
   * into a 429 with a `Retry-After` header is REST's shape for it and an error
   * frame is the WS one; only the caller knows which transport it is on.
   */
  async consume(
    policy: RateLimitPolicyName,
    context: RateLimitContext,
    cost = 1,
  ): Promise<RateLimitDecision> {
    const { capacity, refillPerSecond } = RATE_LIMIT_POLICIES[policy];

    const result = await this.store.consume({
      key: buildRateLimitKey(policy, context),
      capacity,
      refillPerSecond,
      cost,
      // The one place in Huddle the clock is read for rate limiting. Keeping it
      // here is what lets the store stay clock-free and testable by arithmetic
      // (see RateLimitRequest.nowMs).
      nowMs: Date.now(),
    });

    return { ...result, limit: capacity };
  }
}
