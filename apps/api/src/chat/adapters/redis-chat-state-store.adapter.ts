import { Injectable, Optional } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import {
  ChatStateStore,
  DeleteResult,
  EditResult,
  SEND_RETENTION_MS,
  SendResult,
  TYPING_DEBOUNCE_MS,
} from '../chat-state-store.interface';

/**
 * The three kinds of result the port files plus the typing flag, and
 * therefore the four key namespaces. Declared here rather than shared: only
 * the implementations care about how a key is composed, and the contract
 * suite's cross-operation case is what keeps them honest.
 */
type StateOp = 'send' | 'edit' | 'delete' | 'typing';

/**
 * Redis-backed socket state — the idempotency of message mutations plus the
 * typing debounce (#67), and the only file in `src/chat/` that may inject
 * `RedisService` (AGENTS.md section 2); that confinement is what keeps the
 * port swappable.
 *
 * Idempotency entries: one string key per `(user, op, nonce)`, holding the
 * ack as JSON, with a `PX` expiry of `ttlMs`. A plain `SET`/`GET` pair is
 * enough — there is no read-modify-write here: the value is written once,
 * whole, and read back. (The rate limiter's Lua script exists because it
 * *does* read-decide-write.)
 *
 * The typing flag is the one key that *is* an atomic check-and-set: a
 * `SET ... NX PX debounceMs`, which returns `OK` only when the window was
 * free — Redis decides that in one command, so two frames racing from the
 * same socket can never both win the window.
 *
 * The op sits in the key (`huddle:chat:edit:…` beside `huddle:chat:send:…`,
 * `huddle:chat:typing:…` beside those) because the kinds share namespaces
 * only where it is safe: the three mutations share one retention window but
 * must never answer each other, and the typing flag is a live window rather
 * than a filed result at all.
 *
 * `ttlMs` is a constructor parameter defaulting to the port's documented
 * 30-second window (chat-service.md section 4); `debounceMs` likewise
 * defaults to `TYPING_DEBOUNCE_MS`. They are injectable so a test can shrink
 * a window and assert the "after the window" half of an expiry AC without
 * sleeping the real duration.
 *
 * Losing a value — eviction, restart, expiry — yields `null` for a recall
 * and a fresh `true` for the flag, which is the safe direction: at worst one
 * duplicate mutation or one extra broadcast, exactly the failure mode
 * AGENTS.md section 8 declares acceptable for everything Redis holds here.
 */
@Injectable()
export class RedisChatStateStore extends ChatStateStore {
  /**
   * `@Optional()` on both windows: TypeScript emits every constructor
   * parameter into Nest's `design:paramtypes` metadata even when it has a
   * default, and Nest would then try to resolve providers of type `Number`
   * and fail at boot. Optional makes them fall through to `undefined`, and
   * `undefined` applies the defaults — which is exactly what DI wants (30
   * seconds, 3 seconds) while `new RedisChatStateStore(redis, ttl, debounce)`
   * in a test still passes its own.
   */
  constructor(
    private readonly redis: RedisService,
    @Optional() public ttlMs: number = SEND_RETENTION_MS,
    @Optional() public debounceMs: number = TYPING_DEBOUNCE_MS,
  ) {
    super();
  }

  async rememberSend(
    userId: bigint,
    key: string,
    result: SendResult,
  ): Promise<void> {
    await this.write('send', userId, key, result);
  }

  async recallSend(userId: bigint, key: string): Promise<SendResult | null> {
    return this.read('send', userId, key, isSendResult);
  }

  async rememberEdit(
    userId: bigint,
    key: string,
    result: EditResult,
  ): Promise<void> {
    await this.write('edit', userId, key, result);
  }

  async recallEdit(userId: bigint, key: string): Promise<EditResult | null> {
    return this.read('edit', userId, key, isEditResult);
  }

  async rememberDelete(
    userId: bigint,
    key: string,
    result: DeleteResult,
  ): Promise<void> {
    await this.write('delete', userId, key, result);
  }

  async recallDelete(
    userId: bigint,
    key: string,
  ): Promise<DeleteResult | null> {
    return this.read('delete', userId, key, isDeleteResult);
  }

  /**
   * The typing debounce as one atomic `SET ... NX PX` (#67): `OK` only if
   * the window was free, `null` if a frame already holds it — so `true`
   * means "broadcast", `false` means "drop". `NX` decides both halves in
   * the single command; a read-then-write here would let two racing frames
   * both win the same window, which is exactly the fan-out the debounce
   * exists to stop.
   *
   * The value is a placeholder flag, not JSON — nothing ever reads it back;
   * only its existence and expiry matter.
   */
  async markTyping(userId: bigint, channelId: bigint): Promise<boolean> {
    const set = await this.redis.set(
      this.fieldFor('typing', userId, channelId.toString()),
      '1',
      'PX',
      this.debounceMs,
      'NX',
    );

    return set === 'OK';
  }

  /**
   * Files the ack as one JSON string under the op's namespace, with the
   * window applied at write time (PX, not EX: the window is defined in
   * milliseconds and the test that shrinks it would otherwise need a second
   * of resolution).
   */
  private async write(
    op: StateOp,
    userId: bigint,
    key: string,
    result: SendResult | EditResult | DeleteResult,
  ): Promise<void> {
    await this.redis.set(
      this.fieldFor(op, userId, key),
      JSON.stringify(result),
      'PX',
      this.ttlMs,
    );
  }

  /** The filed result for `(op, user, key)`, or `null` on any kind of miss. */
  private async read<Res>(
    op: StateOp,
    userId: bigint,
    key: string,
    isResult: (value: unknown) => value is Res,
  ): Promise<Res | null> {
    const stored = await this.redis.get(this.fieldFor(op, userId, key));

    if (stored === null) return null;

    try {
      const parsed: unknown = JSON.parse(stored);

      // Only reachable if something other than this adapter wrote the key —
      // values go in as JSON.stringify output here and nothing else touches
      // them. Treating a stranger's value as a miss is the safe direction:
      // a duplicate mutation rather than an ack built from someone else's id.
      if (!isResult(parsed)) return null;

      return parsed;
    } catch {
      // A value that is not JSON at all — same reasoning as above, and the
      // key expires regardless (AGENTS.md section 8).
      return null;
    }
  }

  /**
   * The key scheme's one composition point:
   * `huddle:chat:<op>:<user>:<nonce>`. Per-user scoping and the op's
   * namespace both live here, so read and write are guaranteed to agree.
   */
  private fieldFor(op: StateOp, userId: bigint, key: string): string {
    return `huddle:chat:${op}:${userId.toString()}:${key}`;
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

/** Narrows a parsed value to `EditResult`, hand-written rather than asserted. */
function isEditResult(value: unknown): value is EditResult {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { messageId?: unknown; editedAt?: unknown };
  return (
    typeof candidate.messageId === 'string' &&
    (typeof candidate.editedAt === 'string' || candidate.editedAt === null)
  );
}

/** Narrows a parsed value to `DeleteResult`, hand-written rather than asserted. */
function isDeleteResult(value: unknown): value is DeleteResult {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { messageId?: unknown };
  return typeof candidate.messageId === 'string';
}
