/**
 * A message, as the rest of the application sees one.
 *
 * Declared here rather than re-exported from the generated Prisma client on
 * purpose: the port is the line the vendor stops at (AGENTS.md section 2).
 * The adapter maps its row onto this shape.
 *
 * There is no `createdAt` field, and that is not an omission — the creation
 * time is decoded from the Snowflake id with `SnowflakeService.timestampFrom`
 * (docs/architecture/data-model.md section 3). The column does not exist
 * either, so nothing here could read it.
 */
export interface Message {
  id: bigint;
  channelId: bigint;
  authorId: bigint;
  content: string;
  editedAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
}

/** The fields needed to store a new message. */
export interface CreateMessageInput {
  channelId: bigint;
  authorId: bigint;
  content: string;
}

/**
 * Persistence for message records.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and an interface is erased at compile time. See
 * docs/architecture/repo-structure.md section 3.
 *
 * Nothing here checks whether the author may post. That decision is already
 * made by `RequireCapabilityGuard` before a caller reaches the service, and
 * repeating it here would give the rule two homes that could disagree.
 */
export abstract class MessageRepository {
  /**
   * Stores a message. Mints the Snowflake id itself, so a caller cannot
   * supply one — which also makes the id monotonic, and therefore a usable
   * pagination cursor (docs/architecture/chat-service.md section 5).
   *
   * `content` is stored exactly as given. Trimming and the 2048-character cap
   * are the DTO's job (`SendMessageDto`), because they are validation of what
   * arrived on the wire rather than a property of storage.
   *
   * Throws `NotFoundError` when the channel no longer exists — the channel
   * can be deleted between the guard's read and this write.
   */
  abstract create(input: CreateMessageInput): Promise<Message>;

  /** The message with this id, or `null`. Soft-deleted rows are returned. */
  abstract findById(id: bigint): Promise<Message | null>;

  /**
   * One page of history, scrolling *backwards*: the messages immediately
   * older than `before`, or the newest ones when it is `null`.
   *
   * Ordered **newest first** and capped at `limit`. The order is the one the
   * `@@index([channelId, id])` index already holds, so the database does the
   * work rather than sorting a result set; the caller reverses the page if it
   * wants it the other way round. `ChatService.getHistory` is that caller and
   * does exactly that.
   *
   * Soft-deleted messages are included, and count toward `limit`. History
   * renders a "message deleted" placeholder in their place (PRD FR-18/FR-19),
   * and filtering them out here would make two pages of the same window
   * disagree about where the boundary is.
   */
  abstract findPageBefore(
    channelId: bigint,
    before: bigint | null,
    limit: number,
  ): Promise<Message[]>;

  /**
   * One page of history, scrolling *forwards*: the messages newer than
   * `after`, oldest first, capped at `limit`.
   *
   * The reconnect catch-up direction (chat-service.md section 6) — "here is
   * the last id I hold, give me what I missed". Unlike `findPageBefore` there
   * is no unbounded form: catching up from nothing is `findPageBefore(null)`.
   *
   * Soft-deleted messages are included here too, for the same reason.
   */
  abstract findPageAfter(
    channelId: bigint,
    after: bigint,
    limit: number,
  ): Promise<Message[]>;
}
