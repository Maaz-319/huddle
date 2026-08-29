import {
  RATE_LIMIT_POLICIES,
  RateLimitDimension,
  RateLimitPolicyName,
} from './rate-limit-policies';

/**
 * Everything about a caller that a bucket can be keyed on.
 *
 * Deliberately transport-neutral rather than an Express `Request`: Phase 8's
 * socket.io path limits the same policies with no request object anywhere in
 * scope, and would otherwise have to synthesise a fake one. The REST guard
 * fills this in from `req`; the gateway fills it in from the handshake and the
 * event payload.
 */
export interface RateLimitContext {
  /**
   * The caller's address, resolved through Express's `trust proxy` — never
   * `req.socket.remoteAddress` and never a raw `X-Forwarded-For` entry. See
   * src/common/trust-proxy.ts for why that distinction is load-bearing.
   */
  ip: string;

  /**
   * The authenticated caller, when there is one — absent on a route nobody is
   * logged into (the OAuth routes themselves, or any request with no session
   * cookie at all). A user-dimensioned policy with no caller id falls back to
   * the IP dimension below rather than going unlimited.
   */
  userId?: bigint;

  /** The channel a per-channel policy acts on. */
  channelId?: bigint;
}

/** The prefix every rate-limit key in Redis carries (rate-limiter.md §2). */
const KEY_PREFIX = 'huddle:rl';

/**
 * Turns a policy plus the current caller into the one Redis key that policy's
 * bucket lives at: `huddle:rl:<policy>:<dimension>:<id>`.
 *
 * The store never builds a key itself — this is the only place the scheme in
 * rate-limiter.md §2 is written down in code.
 */
export function buildRateLimitKey(
  name: RateLimitPolicyName,
  context: RateLimitContext,
): string {
  const { dimension, id } = resolveDimension(name, context);

  return `${KEY_PREFIX}:${name}:${dimension}:${id}`;
}

function resolveDimension(
  name: RateLimitPolicyName,
  context: RateLimitContext,
): { dimension: RateLimitDimension; id: string } {
  const { dimension } = RATE_LIMIT_POLICIES[name];

  if (dimension === 'channel') {
    if (context.channelId === undefined) {
      // A per-channel policy is only ever applied to something that already
      // knows its channel, so an absent id is a wiring bug. Falling back
      // would quietly merge every channel into one bucket and still return
      // plausible 429s, which is the version of this failure nobody notices.
      throw new Error(
        `Rate limit policy '${name}' is per-channel but no channelId was supplied`,
      );
    }

    return { dimension, id: context.channelId.toString() };
  }

  if (dimension === 'user' && context.userId !== undefined) {
    return { dimension, id: context.userId.toString() };
  }

  if (context.ip === '') {
    throw new Error(
      `Rate limit policy '${name}' resolved to the ip dimension but no ip was supplied`,
    );
  }

  // Either the policy is per-IP, or it is per-user and the caller has no
  // session. See RateLimitContext.userId.
  return { dimension: 'ip', id: context.ip };
}
