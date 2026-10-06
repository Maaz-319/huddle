/**
 * What one send acknowledged, minus the key it was filed under — the
 * idempotency key is the caller's, and the ack echoes whatever came in, so
 * there is no reason to store it twice.
 *
 * Both fields are already the JSON shapes that cross the wire: the id as a
 * string per AGENTS.md section 4, `createdAt` as the ISO timestamp decoded
 * from the Snowflake (there is no such column — `Message.createdAt` is
 * derived, see docs/architecture/data-model.md section 3).
 */
export interface SendResult {
  messageId: string;
  createdAt: string;
}

/**
 * The retention window docs/architecture/chat-service.md section 4 fixes for
 * a repeated idempotency key: long enough to cover a client's auto-retry
 * round trip, short enough that the keys are worthless afterwards.
 */
export const SEND_RETENTION_MS = 30_000;

/**
 * Phase 8's short-lived socket state, Redis-backed: one port holds all of it
 * so #67 and #70 add their methods here rather than each inventing a store
 * (issue #65's spec).
 *
 * Everything this stores is **intentionally ephemeral** (AGENTS.md section
 * 8): a lost key means one duplicate message, never a correctness bug, so
 * nothing here is ever allowed to gate correctness on surviving a restart.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and a TS interface is erased at compile time — see
 * docs/architecture/repo-structure.md section 3.
 */
export abstract class ChatStateStore {
  /**
   * Files the outcome of one send under `(userId, key)` until the retention
   * window passes. Keys are scoped per user so two clients that pick the same
   * nonce cannot collide.
   */
  abstract rememberSend(
    userId: bigint,
    key: string,
    result: SendResult,
  ): Promise<void>;

  /**
   * The result filed under `(userId, key)`, or `null` when there is none —
   * never fired, expired outside the window, or evicted by a restart. Callers
   * treat `null` as "send it for real".
   */
  abstract recallSend(userId: bigint, key: string): Promise<SendResult | null>;
}
