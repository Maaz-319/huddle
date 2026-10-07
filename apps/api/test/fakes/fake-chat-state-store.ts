import {
  ChatStateStore,
  DeleteResult,
  EditResult,
  SEND_RETENTION_MS,
  SendResult,
  TYPING_DEBOUNCE_MS,
  VIOLATION_WINDOW_MS,
} from '../../src/chat/chat-state-store.interface';

interface Filed<Result> {
  result: Result;
  expiresAt: number;
}

/**
 * In-memory `ChatStateStore`, for unit tests of everything that depends on
 * the port — the gateway's ack/dedupe path and the typing debounce — without
 * Docker.
 *
 * `extends ChatStateStore` rather than duck-typing it: adding a method to the
 * port then breaks compilation here, which is the only thing keeping a fake
 * honest as the port grows. The three mutation kinds get one map each, so
 * recalling a send can never hand back an edit's result — the same isolation
 * the real adapter gets from its op-namespaced keys.
 *
 * Unlike the rate-limit fake, this one *does* model expiry: the retention,
 * debounce, and escalation windows are part of the port's contract (the
 * shared suite asserts each), and a fake that remembered forever would make
 * that contract pass while the real adapter expired keys. The clock is
 * `Date.now` at call time — the port's methods take no timestamp, so wall
 * time is the only thing both implementations can be compared on.
 */
export class FakeChatStateStore extends ChatStateStore {
  private readonly sendEntries = new Map<string, Filed<SendResult>>();
  private readonly editEntries = new Map<string, Filed<EditResult>>();
  private readonly deleteEntries = new Map<string, Filed<DeleteResult>>();

  /**
   * Field → the window's start, for the typing debounce. Expiry is judged on
   * read against `debounceMs` rather than by deleting on a timer, mirroring
   * how the Redis adapter's `PX` lets Redis expire the key lazily — a stale
   * entry behaves exactly like a missing one.
   */
  private readonly typingWindows = new Map<string, number>();

  /**
   * User → `{count, expiresAt}` for the escalation counter. Same lazy
   * expiry-on-read as the typing flags: a stale entry is treated as absent,
   * which is how Redis's `PX` behaves for a key it has not swept yet.
   */
  private readonly violations = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(
    public ttlMs: number = SEND_RETENTION_MS,
    public debounceMs: number = TYPING_DEBOUNCE_MS,
    public violationWindowMs: number = VIOLATION_WINDOW_MS,
  ) {
    super();
  }

  rememberSend(userId: bigint, key: string, result: SendResult): Promise<void> {
    this.file(this.sendEntries, userId, key, result);
    return Promise.resolve();
  }

  recallSend(userId: bigint, key: string): Promise<SendResult | null> {
    return Promise.resolve(this.recallFrom(this.sendEntries, userId, key));
  }

  rememberEdit(userId: bigint, key: string, result: EditResult): Promise<void> {
    this.file(this.editEntries, userId, key, result);
    return Promise.resolve();
  }

  recallEdit(userId: bigint, key: string): Promise<EditResult | null> {
    return Promise.resolve(this.recallFrom(this.editEntries, userId, key));
  }

  rememberDelete(
    userId: bigint,
    key: string,
    result: DeleteResult,
  ): Promise<void> {
    this.file(this.deleteEntries, userId, key, result);
    return Promise.resolve();
  }

  recallDelete(userId: bigint, key: string): Promise<DeleteResult | null> {
    return Promise.resolve(this.recallFrom(this.deleteEntries, userId, key));
  }

  markTyping(userId: bigint, channelId: bigint): Promise<boolean> {
    const field = `${userId.toString()}:${channelId.toString()}`;
    const windowStart = this.typingWindows.get(field);
    const now = Date.now();

    if (windowStart !== undefined && now - windowStart < this.debounceMs) {
      return Promise.resolve(false);
    }

    this.typingWindows.set(field, now);
    return Promise.resolve(true);
  }

  recordViolation(userId: bigint): Promise<number> {
    const field = userId.toString();
    const now = Date.now();
    const existing = this.violations.get(field);

    // Fixed window: only the first violation sets the deadline, later ones
    // add to the count without extending it — the port's contract, and the
    // difference between "hammering keeps me going forever" and "quiet for
    // sixty seconds or it starts over".
    if (existing === undefined || existing.expiresAt <= now) {
      this.violations.set(field, {
        count: 1,
        expiresAt: now + this.violationWindowMs,
      });
      return Promise.resolve(1);
    }

    existing.count += 1;
    return Promise.resolve(existing.count);
  }

  private file<Result>(
    entries: Map<string, Filed<Result>>,
    userId: bigint,
    key: string,
    result: Result,
  ): void {
    entries.set(this.fieldFor(userId, key), {
      result,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  private recallFrom<Result>(
    entries: Map<string, Filed<Result>>,
    userId: bigint,
    key: string,
  ): Result | null {
    const field = this.fieldFor(userId, key);
    const filed = entries.get(field);

    if (filed === undefined) return null;

    if (filed.expiresAt <= Date.now()) {
      entries.delete(field);
      return null;
    }

    return filed.result;
  }

  private fieldFor(userId: bigint, key: string): string {
    return `${userId.toString()}:${key}`;
  }
}
