import { Injectable, Optional } from '@nestjs/common';
import type { ClientContext, Result } from 'ioredis';
import { RedisService } from '../../common/redis.service';
import {
  ChatStateStore,
  DeleteResult,
  EditResult,
  SEND_RETENTION_MS,
  SendResult,
  TYPING_DEBOUNCE_MS,
  VIOLATION_WINDOW_MS,
} from '../chat-state-store.interface';

/**
 * The three kinds of result the port files, the typing flag, and the
 * escalation counter — and therefore the key namespaces. Declared here
 * rather than shared: only the implementations care about how a key is
 * composed, and the contract suite's cross-operation case is what keeps
 * them honest. The violation counter is the one namespace without a nonce
 * segment (its key is the user alone — see `violationFieldFor`), so it is
 * composed outside `fieldFor`.
 */
type StateOp = 'send' | 'edit' | 'delete' | 'typing';

/**
 * Teaches TypeScript about the command `defineCommand` installs at runtime,
 * augmenting ioredis's `RedisCommander` exactly the way the rate-limit
 * adapter's script does — the documented way to do this, and what keeps the
 * call site free of a cast (AGENTS.md section 4). Two files may declare it;
 * the interface declarations merge.
 */
declare module 'ioredis' {
  interface RedisCommander<
    Context extends ClientContext = { type: 'default' },
  > {
    huddleRecordViolation(
      key: string,
      windowMs: string,
    ): Result<unknown, Context>;
  }
}

/**
 * Count one violation and open the window if this is the first, as one
 * atomic step.
 *
 * It is a script because the pair is a read-decide-write: two commands
 * (`INCR`, then `PEXPIRE` only when the reply was 1) can interleave, and a
 * counter whose deadline was never written would live forever — climbing
 * until the user is disconnected over refusals spread across weeks. Redis
 * runs a script to completion with nothing interleaved, which is the only
 * way the TTL is guaranteed to exist exactly when the count says it should.
 * Same standard that put the rate limiter's own script in Lua
 * (rate-limiter.md section 2).
 */
const RECORD_VIOLATION_SCRIPT = `
-- KEYS[1] violation counter key
-- ARGV[1] window in milliseconds
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

/**
 * Redis-backed socket state — the idempotency of message mutations, the
 * typing debounce (#67), and the escalation counter (#70), and the only file
 * in `src/chat/` that may inject `RedisService` (AGENTS.md section 2); that
 * confinement is what keeps the port swappable.
 *
 * Idempotency entries: one string key per `(user, op, nonce)`, holding the
 * ack as JSON, with a `PX` expiry of `ttlMs`. A plain `SET`/`GET` pair is
 * enough — there is no read-modify-write here: the value is written once,
 * whole, and read back.
 *
 * The typing flag is the one key that *is* an atomic check-and-set: a
 * `SET ... NX PX debounceMs`, which returns `OK` only when the window was
 * free — Redis decides that in one command, so two frames racing from the
 * same socket can never both win the window.
 *
 * The violation counter (`huddle:chat:violations:<user>`) is a plain integer
 * incremented by the Lua script above, carrying a `PX` of `violationWindowMs`
 * written atomically with the increment that opened the window (rate-limiter.md
 * section 7). Nothing reads it back except the increment's own reply.
 *
 * The op sits in the key (`huddle:chat:edit:…` beside `huddle:chat:send:…`,
 * `huddle:chat:typing:…` beside those) because the kinds share namespaces
 * only where it is safe: the three mutations share one retention window but
 * must never answer each other, the typing flag is a live window rather than
 * a filed result at all, and the violation counter predates no nonce at all.
 *
 * `ttlMs` is a constructor parameter defaulting to the port's documented
 * 30-second window (chat-service.md section 4); `debounceMs` likewise
 * defaults to `TYPING_DEBOUNCE_MS`, and `violationWindowMs` to
 * `VIOLATION_WINDOW_MS`. They are injectable so a test can shrink a window
 * and assert the "after the window" half of an expiry AC without sleeping
 * the real duration.
 *
 * Losing a value — eviction, restart, expiry — yields `null` for a recall,
 * a fresh `true` for the flag, and a fresh `1` for the counter, which is the
 * safe direction: at worst one duplicate mutation, one extra broadcast, or
 * one flood given a clean slate, exactly the failure mode AGENTS.md section
 * 8 declares acceptable for everything Redis holds here.
 */
@Injectable()
export class RedisChatStateStore extends ChatStateStore {
  /**
   * `@Optional()` on every window: TypeScript emits each constructor
   * parameter into Nest's `design:paramtypes` metadata even when it has a
   * default, and Nest would then try to resolve providers of type `Number`
   * and fail at boot. Optional makes them fall through to `undefined`, and
   * `undefined` applies the defaults — which is exactly what DI wants (30
   * seconds, 3 seconds, 60 seconds) while
   * `new RedisChatStateStore(redis, ttl, debounce, window)` in a test still
   * passes its own.
   */
  constructor(
    private readonly redis: RedisService,
    @Optional() public ttlMs: number = SEND_RETENTION_MS,
    @Optional() public debounceMs: number = TYPING_DEBOUNCE_MS,
    @Optional() public violationWindowMs: number = VIOLATION_WINDOW_MS,
  ) {
    super();

    // `defineCommand` rather than `eval`: it sends EVALSHA and only falls
    // back to a full EVAL when Redis answers NOSCRIPT, so the script body
    // does not travel on every violation. The fallback is what makes it
    // survive a Redis restart, which drops the script cache.
    this.redis.defineCommand('huddleRecordViolation', {
      numberOfKeys: 1,
      lua: RECORD_VIOLATION_SCRIPT,
    });
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
   * The escalation counter (#70, rate-limiter.md section 7): one increment
   * per refusal, the window's `PX` opened atomically with the increment that
   * created the key, and the new count handed straight back — which is the
   * only read this key ever serves. A restart zeroes it, and that fails
   * lenient: a flood gets a clean slate, never an innocent user locked out.
   */
  async recordViolation(userId: bigint): Promise<number> {
    const reply: unknown = await this.redis.huddleRecordViolation(
      this.violationFieldFor(userId),
      String(this.violationWindowMs),
    );

    if (typeof reply !== 'number') {
      // Only reachable if the script above and this guard disagree, which is
      // a bug here rather than anything a caller did. Failing loudly beats
      // handing back a count nobody can trust against VIOLATION_LIMIT.
      throw new Error(
        `Violation script returned an unexpected reply: ${JSON.stringify(reply)}`,
      );
    }

    return reply;
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

  /**
   * The violation counter's key: `huddle:chat:violations:<user>` — no nonce
   * segment, because there is one counter per user and nothing filed under
   * it besides the count itself. The contract suite leans on the same
   * composition (a `99*` user glob, see CHAT_STATE_CONTRACT_VIOLATIONS_PATTERN)
   * to clean up after itself.
   */
  private violationFieldFor(userId: bigint): string {
    return `huddle:chat:violations:${userId.toString()}`;
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
