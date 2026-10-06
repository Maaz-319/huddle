import { Injectable, Optional } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import {
  ChatStateStore,
  SEND_RETENTION_MS,
  SendResult,
} from '../chat-state-store.interface';

/**
 * Redis-backed idempotency for message sends — the only file in `src/chat/`
 * that may inject `RedisService` (AGENTS.md section 2); that confinement is
 * what keeps the port swappable.
 *
 * One string key per `(user, nonce)`, holding the ack as JSON, with a `PX`
 * expiry of `ttlMs`. A plain `SET`/`GET` pair is enough — there is no
 * read-modify-write here: the value is written once, whole, and read back.
 * (The rate limiter's Lua script exists because it *does* read-decide-write.)
 *
 * `ttlMs` is a constructor parameter defaulting to the port's documented
 * 30-second window (chat-service.md section 4). It is injectable so a test
 * can shrink the window and assert the "after the window" half of the
 * idempotency AC without sleeping for thirty seconds.
 *
 * Losing the value — eviction, restart, expiry — yields `null`, which callers
 * treat as "send for real": at worst one duplicate message, which is exactly
 * the failure mode AGENTS.md section 8 declares acceptable for everything
 * Redis holds here.
 */
@Injectable()
export class RedisChatStateStore extends ChatStateStore {
  /**
   * `@Optional()` on the TTL: TypeScript emits every constructor parameter
   * into Nest's `design:paramtypes` metadata even when it has a default, and
   * Nest would then try to resolve a provider of type `Number` and fail at
   * boot. Optional makes it fall through to `undefined`, and `undefined`
   * applies the default — which is exactly what DI wants (30 seconds) while
   * `new RedisChatStateStore(redis, ttlMs)` in a test still passes its own.
   */
  constructor(
    private readonly redis: RedisService,
    @Optional() public ttlMs: number = SEND_RETENTION_MS,
  ) {
    super();
  }

  async rememberSend(
    userId: bigint,
    key: string,
    result: SendResult,
  ): Promise<void> {
    // PX, not EX: the window is defined in milliseconds and the test that
    // shrinks it would otherwise need a second of resolution.
    await this.redis.set(
      this.fieldFor(userId, key),
      JSON.stringify(result),
      'PX',
      this.ttlMs,
    );
  }

  async recallSend(userId: bigint, key: string): Promise<SendResult | null> {
    const stored = await this.redis.get(this.fieldFor(userId, key));

    if (stored === null) return null;

    try {
      const parsed: unknown = JSON.parse(stored);

      // Only reachable if something other than this adapter wrote the key —
      // values go in as JSON.stringify output here and nothing else touches
      // them. Treating a stranger's value as a miss is the safe direction:
      // a duplicate message rather than an ack carrying someone else's id.
      if (!isSendResult(parsed)) return null;

      return parsed;
    } catch {
      // A value that is not JSON at all — same reasoning as above, and the
      // key expires regardless (AGENTS.md section 8).
      return null;
    }
  }

  /**
   * The key scheme's one composition point: `huddle:chat:send:<user>:<nonce>`.
   * Per-user scoping lives here, so both methods are guaranteed to agree.
   */
  private fieldFor(userId: bigint, key: string): string {
    return `huddle:chat:send:${userId.toString()}:${key}`;
  }
}

/** Narrows a parsed value to `SendResult`, hand-written rather than asserted. */
function isSendResult(value: unknown): value is SendResult {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { messageId?: unknown; createdAt?: unknown };
  return (
    typeof candidate.messageId === 'string' &&
    typeof candidate.createdAt === 'string'
  );
}
