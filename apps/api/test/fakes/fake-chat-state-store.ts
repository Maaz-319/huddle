import {
  ChatStateStore,
  SEND_RETENTION_MS,
  SendResult,
} from '../../src/chat/chat-state-store.interface';

interface Filed {
  result: SendResult;
  expiresAt: number;
}

/**
 * In-memory `ChatStateStore`, for unit tests of everything that depends on
 * the port — the gateway's ack/dedupe path — without Docker.
 *
 * `extends ChatStateStore` rather than duck-typing it: adding a method to the
 * port then breaks compilation here, which is the only thing keeping a fake
 * honest as the port grows.
 *
 * Unlike the rate-limit fake, this one *does* model expiry: the retention
 * window is part of the port's contract (the shared suite asserts it), and a
 * fake that remembered forever would make that contract pass while the real
 * adapter expired keys. The clock is `Date.now` at call time — the port's
 * methods take no timestamp, so wall time is the only thing both
 * implementations can be compared on.
 */
export class FakeChatStateStore extends ChatStateStore {
  private readonly entries = new Map<string, Filed>();

  constructor(public ttlMs: number = SEND_RETENTION_MS) {
    super();
  }

  rememberSend(userId: bigint, key: string, result: SendResult): Promise<void> {
    this.entries.set(this.fieldFor(userId, key), {
      result,
      expiresAt: Date.now() + this.ttlMs,
    });
    return Promise.resolve();
  }

  recallSend(userId: bigint, key: string): Promise<SendResult | null> {
    const field = this.fieldFor(userId, key);
    const filed = this.entries.get(field);

    if (filed === undefined) return Promise.resolve(null);

    if (filed.expiresAt <= Date.now()) {
      this.entries.delete(field);
      return Promise.resolve(null);
    }

    return Promise.resolve(filed.result);
  }

  private fieldFor(userId: bigint, key: string): string {
    return `${userId.toString()}:${key}`;
  }
}
