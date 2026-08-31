import { Injectable } from '@nestjs/common';
import { Message, MessageRepository } from './message-repository.interface';

/**
 * Which direction a history request is asking in. At most one of the two is
 * ever set — `CursorPaginationDto` rejects a request carrying both, so this
 * type never has to describe what their combination would mean.
 */
export interface HistoryCursor {
  before?: bigint;
  after?: bigint;
}

/** One page of history, plus whether the direction asked for has more. */
export interface MessagePage {
  /** Always oldest → newest, whichever cursor was sent. */
  messages: Message[];

  /** Whether at least one more row exists past this page, that way. */
  hasMore: boolean;
}

/**
 * Message create, edit, delete and history — the business logic behind both
 * the REST routes here and, from Phase 8, the socket.io gateway. The gateway
 * calls these same methods rather than reimplementing them, which is the
 * reason this is a service and not logic inlined into the controller.
 *
 * It deliberately holds no permission checks. `RequireCapabilityGuard` has
 * already resolved the caller's effective capability in the channel by the
 * time a method here runs, including the owner short-circuit, the
 * private-channel hiding rule, and channel overrides. A second check here
 * would be a second copy of a rule that already has one home.
 */
@Injectable()
export class ChatService {
  constructor(private readonly messages: MessageRepository) {}

  /**
   * Stores a message. `content` is already trimmed and length-checked by
   * `SendMessageDto`; the id and creation time both come from the Snowflake
   * the repository mints.
   */
  sendMessage(
    channelId: bigint,
    authorId: bigint,
    content: string,
  ): Promise<Message> {
    return this.messages.create({ channelId, authorId, content });
  }

  /**
   * One page of a channel's history, in whichever direction the cursor asks
   * for. `after` catches a reconnecting client up; `before` scrolls back;
   * neither means the newest page (chat-service.md sections 5 and 6).
   *
   * The two are mutually exclusive, and `CursorPaginationDto` has already
   * rejected a request naming both — so `after` winning here is not a
   * precedence rule, it is a branch that can only be reached one way.
   *
   * `hasMore` costs no second query: one extra row is asked for, and its
   * presence is the answer. A `count` would be a second scan of the same
   * index for a boolean.
   *
   * The page always comes back **oldest → newest**, whichever cursor was
   * sent, so a client never has to know which way it asked in order to read
   * the reply. The backwards query is fetched newest-first because that is
   * the order `@@index([channelId, id])` holds, and reversed here — that is
   * deliberate, not an oversight to be tidied away.
   */
  async getHistory(
    channelId: bigint,
    cursor: HistoryCursor,
    limit: number,
  ): Promise<MessagePage> {
    const overfetch = limit + 1;

    const rows =
      cursor.after === undefined
        ? await this.messages.findPageBefore(
            channelId,
            cursor.before ?? null,
            overfetch,
          )
        : await this.messages.findPageAfter(channelId, cursor.after, overfetch);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      messages: cursor.after === undefined ? page.reverse() : page,
      hasMore,
    };
  }
}
