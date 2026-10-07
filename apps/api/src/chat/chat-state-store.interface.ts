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
 * The escalation window docs/architecture/rate-limiter.md section 7 fixes for
 * counting a user's rate-limit refusals: refusals inside one minute of the
 * first count toward a disconnect, the window then expires and the counter
 * starts over. Sixty seconds is chosen so an honest retry storm cools off on
 * its own while a scripted flood cannot pace itself just under the limit and
 * keep going forever. Kept beside the other two windows because all three are
 * the port's contract, and the contract suite asserts each against both
 * implementations.
 */
export const VIOLATION_WINDOW_MS = 60_000;

/**
 * How many rate-limit refusals inside one `VIOLATION_WINDOW_MS` window
 * escalate to a disconnect (#70, rate-limiter.md section 7). Five is one more
 * than the strictest per-event budget admits in a second, so a single unlucky
 * burst never trips it — a client has to be refused repeatedly, i.e. ignoring
 * `retryable: true` and hammering anyway, before its socket is closed.
 */
export const VIOLATION_LIMIT = 5;

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

  /**
   * Counts one rate-limit refusal against `userId` inside the current
   * `VIOLATION_WINDOW_MS` window and returns the new count — the number the
   * gateway compares against `VIOLATION_LIMIT` to decide whether this refusal
   * is the one that closes the connection (#70, rate-limiter.md section 7).
   *
   * The window is fixed from the **first** violation: the first call opens it
   * and later calls neither extend nor restart it, so a flood cannot keep its
   * own counter alive by pausing briefly between refusals — only actually
   * going quiet for a full window resets it. Per user, not per connection:
   * violations accumulate across every socket the user has open, while only
   * the socket that committed the violation is disconnected.
   *
   * The decision to disconnect belongs to the caller, not the store: this
   * method only counts, and the gateway decides what a count means for the
   * frame it just refused. Implementations may shorten the window via their
   * constructor so tests need not wait the default `VIOLATION_WINDOW_MS`.
   *
   * Like everything else here it is **intentionally ephemeral**: a Redis
   * restart zeroes the counters, which fails in the lenient direction (a
   * flood gets a clean slate, never an innocent user locked out).
   */
  abstract recordViolation(userId: bigint): Promise<number>;
}
