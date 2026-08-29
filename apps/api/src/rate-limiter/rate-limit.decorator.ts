import { SetMetadata } from '@nestjs/common';
import { RateLimitPolicyName } from './rate-limit-policies';

/** The `Reflector` key `RateLimitGuard` reads the policy name back from. */
export const RATE_LIMIT_KEY = 'rateLimit';

/**
 * Marks a route, or every route on a controller, as limited by the named
 * budget from `rate-limit-policies.ts`.
 *
 * Typed against `RateLimitPolicyName` rather than `string`, so
 * `@RateLimit('mesage-send')` is a compile error rather than a silently
 * unlimited route. Applying it to a handler overrides a class-level policy
 * (`RateLimitGuard` reads handler metadata before class metadata).
 *
 * An undecorated route makes no Redis call at all — coverage is opt-in
 * (docs/architecture/rate-limiter.md section 5).
 */
export const RateLimit = (policy: RateLimitPolicyName) =>
  SetMetadata(RATE_LIMIT_KEY, policy);
