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
 * What one edit acknowledged: the message that changed, and the timestamp
 * that puts the "(edited)" marker on it. Nullable for the same reason
 * `MessageResponse.editedAt` is — one nullability story across every event a
 * message produces — even though a successful edit has just stamped it.
 */
export interface EditResult {
  messageId: string;
  editedAt: string | null;
}

/**
 * What one delete acknowledged. Just the id: the client that asked for the
 * deletion holds the message already, and the placeholder it renders carries
 * no timestamp (PRD FR-18/FR-19).
 */
export interface DeleteResult {
  messageId: string;
}

/**
 * The retention window docs/architecture/chat-service.md section 4 fixes for
 * a repeated idempotency key: long enough to cover a client's auto-retry
 * round trip, short enough that the keys are worthless afterwards. #66 files
 * edits and deletes under the same window.
 */
export const SEND_RETENTION_MS = 30_000;

/**
 * The typing debounce window docs/architecture/chat-service.md section 7
 * fixes at "~3 seconds per user per channel": the first `typing` frame of a
 * window goes on to broadcast, every repeat inside it is dropped before it
 * can fan out. Kept here beside the retention window because both are the
 * port's contract, and the contract suite asserts each against both
 * implementations.
 */
export const TYPING_DEBOUNCE_MS = 3_000;

/**
 * Phase 8's short-lived socket state, Redis-backed: one port holds all of it
 * so #67 and #70 add their methods here rather than each inventing a store
 * (issue #65's spec).
 *
 * Edits and deletes are deduped exactly like sends (#66): the same key used
 * twice inside the window returns the original result instead of performing
 * the mutation again — an edit replay must not re-stamp `editedAt`, and a
 * delete replay must not re-broadcast. The three kinds share one window but
 * not one namespace, so one nonce cannot let a send answer an edit's replay.
 *
 * Everything this stores is **intentionally ephemeral** (AGENTS.md section
 * 8): a lost key means one duplicate mutation, never a correctness bug, so
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

  /**
   * Files the outcome of one edit under `(userId, key)` for the same window
   * and with the same per-user scoping as a send.
   */
  abstract rememberEdit(
    userId: bigint,
    key: string,
    result: EditResult,
  ): Promise<void>;

  /** The filed edit result, or `null` — callers treat `null` as "edit for real". */
  abstract recallEdit(userId: bigint, key: string): Promise<EditResult | null>;

  /**
   * Files the outcome of one delete under `(userId, key)`, same window,
   * same per-user scoping. Only the id: the delete itself is already done.
   */
  abstract rememberDelete(
    userId: bigint,
    key: string,
    result: DeleteResult,
  ): Promise<void>;

  /** The filed delete result, or `null` — callers treat `null` as "delete for real". */
  abstract recallDelete(
    userId: bigint,
    key: string,
  ): Promise<DeleteResult | null>;

  /**
   * Whether `(userId, channelId)` is the **first** typing frame of its
   * debounce window: `true` sets the window and says "broadcast", `false`
   * means a frame already claimed it and this one must be dropped
   * (#67, chat-service.md section 7).
   *
   * The window is per user **and** per channel — typing in two channels
   * broadcasts in both, and two people typing in one channel broadcast
   * separately — so the key spans both ids.
   *
   * A `false` is the normal case while somebody types: the caller drops the
   * frame silently, with no error frame and nothing the rate limiter ever
   * sees. Implementations may shorten the window via their constructor so
   * tests need not sleep the default `TYPING_DEBOUNCE_MS`.
   */
  abstract markTyping(userId: bigint, channelId: bigint): Promise<boolean>;
}
