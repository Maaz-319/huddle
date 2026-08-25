import { Injectable } from '@nestjs/common';
import type { ClientContext, Result } from 'ioredis';
import { RedisService } from '../../common/redis.service';
import {
  RateLimitRequest,
  RateLimitResult,
  RateLimitStore,
} from '../rate-limit-store.interface';

/**
 * Teaches TypeScript about the command `defineCommand` installs at runtime.
 *
 * Augmenting ioredis's own `RedisCommander` is the documented way to do this,
 * and it is what keeps the call site below free of a cast — `any` and
 * `as unknown as T` are banned (AGENTS.md section 4). The reply is typed
 * `unknown` rather than a tuple on purpose: the shape is Redis's word, not
 * ours, so it gets narrowed by a real guard instead of an assertion.
 */
declare module 'ioredis' {
  interface RedisCommander<
    Context extends ClientContext = { type: 'default' },
  > {
    huddleRateLimitConsume(
      key: string,
      capacity: string,
      refillPerSecond: string,
      cost: string,
      nowMs: string,
    ): Result<unknown, Context>;
  }
}

/**
 * The whole check-and-consume, as one script.
 *
 * It is a script because a read-modify-write spread across separate commands is
 * a race: two requests both read one token left, both decide they may spend it,
 * and both do (docs/architecture/rate-limiter.md section 2). Redis runs a script
 * to completion with nothing interleaved, which is the only reason the count is
 * ever right under concurrency.
 *
 * Every number crosses the wire as a string and comes back as an integer —
 * Redis has no float and no boolean in its reply protocol. Hence the `1`/`0`
 * and the `math.floor` at the end.
 */
const CONSUME_SCRIPT = `
-- KEYS[1] bucket key
-- ARGV: capacity, refillPerSecond, cost, nowMs
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])
local now      = tonumber(ARGV[4])

local state     = redis.call('HMGET', KEYS[1], 'tokens', 'updatedAt')
local tokens    = tonumber(state[1])
local updatedAt = tonumber(state[2])

-- An absent bucket is a full one, so an expired or lost bucket fails open
-- rather than locking someone out.
if tokens == nil then
  tokens = capacity
  updatedAt = now
end

tokens = math.min(capacity, tokens + ((now - updatedAt) / 1000) * refill)

local allowed = tokens >= cost
if allowed then tokens = tokens - cost end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'updatedAt', now)

-- The row is worthless once it has refilled to full, so it expires then and
-- idle buckets do not accumulate. Every Redis key in Huddle is ephemeral by
-- design (AGENTS.md section 8).
local ttlMs = math.ceil(((capacity - tokens) / refill) * 1000) + 1000
redis.call('PEXPIRE', KEYS[1], ttlMs)

local retryAfterMs = 0
if not allowed then
  retryAfterMs = math.ceil(((cost - tokens) / refill) * 1000)
end

return { allowed and 1 or 0, math.floor(tokens), retryAfterMs }
`;

/**
 * Redis-backed token buckets.
 *
 * The only file in `src/rate-limiter/` that may inject `RedisService`
 * (AGENTS.md section 2) — that confinement is what makes the port swappable.
 * `RedisService` comes from the `@Global()` `CommonModule`, so the module needs
 * no import for it.
 *
 * Bucket keys follow `huddle:rl:<policy>:<dimension>:<id>`, e.g.
 * `huddle:rl:message-send:channel:8901234567890123`
 * (docs/architecture/rate-limiter.md section 2). This class never builds one.
 * It is handed a key, which is what lets Phase 8's WS path call it with keys of
 * its own shape rather than forcing every caller through an HTTP-shaped
 * key-builder.
 *
 * One Redis hash per bucket, holding the token count and the timestamp it was
 * last refilled from.
 */
@Injectable()
export class RedisRateLimitStore extends RateLimitStore {
  constructor(private readonly redis: RedisService) {
    super();

    // `defineCommand` rather than `eval`: it sends EVALSHA and only falls back
    // to a full EVAL when Redis answers NOSCRIPT, so the script body does not
    // travel on every single request. The fallback is what makes it survive a
    // Redis restart, which drops the script cache.
    this.redis.defineCommand('huddleRateLimitConsume', {
      numberOfKeys: 1,
      lua: CONSUME_SCRIPT,
    });
  }

  async consume(request: RateLimitRequest): Promise<RateLimitResult> {
    const reply: unknown = await this.redis.huddleRateLimitConsume(
      request.key,
      String(request.capacity),
      String(request.refillPerSecond),
      String(request.cost),
      String(request.nowMs),
    );

    if (!isConsumeReply(reply)) {
      // Only reachable if the script above and this guard disagree, which is a
      // bug here rather than anything a caller did. Failing loudly beats
      // handing back a bucket state nobody can trust.
      throw new Error(
        `Rate limit script returned an unexpected reply: ${JSON.stringify(reply)}`,
      );
    }

    const [allowed, remaining, retryAfterMs] = reply;

    return { allowed: allowed === 1, remaining, retryAfterMs };
  }
}

/**
 * Narrows the script's reply to the three integers it returns.
 *
 * Hand-written because the alternative is a cast, and a cast here would make a
 * changed script a silent wrong answer instead of a loud failure.
 */
function isConsumeReply(reply: unknown): reply is [number, number, number] {
  return (
    Array.isArray(reply) &&
    reply.length === 3 &&
    reply.every((value) => typeof value === 'number')
  );
}
