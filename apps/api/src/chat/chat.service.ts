import { Injectable } from '@nestjs/common';
import { ChannelMemberRepository } from '../administration/channel-member-repository.interface';
import { ChannelOverrideRepository } from '../administration/channel-override-repository.interface';
import { ChannelRepository } from '../administration/channel-repository.interface';
import { MembershipRepository } from '../administration/membership-repository.interface';
import {
  capabilityRefusalError,
  hiddenChannelError,
} from '../auth/capability-refusal';
import { resolveCapability } from '../auth/resolve-capability';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../common/errors';
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
 * For the REST routes it deliberately holds no permission checks of its own:
 * `RequireCapabilityGuard` has already resolved the caller's effective
 * capability by the time a method here runs — owner short-circuit, private
 * channel hiding rule, channel overrides included. A second check here would
 * be a second copy of a rule that already has one home.
 *
 * The socket path is the exception that proves the arrangement: gateway event
 * handlers have no guard around them (Nest does not apply route guards there
 * the way they run on HTTP), so `requirePost` is the one place a socket
 * caller's capability is resolved — through the same `resolveCapability` and
 * the same `capabilityRefusalError` mapping the guard uses, not a second copy
 * of either.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly channels: ChannelRepository,
    private readonly memberships: MembershipRepository,
    private readonly channelMembers: ChannelMemberRepository,
    private readonly channelOverrides: ChannelOverrideRepository,
  ) {}

  /**
   * Stores a message — **the** write path, the one both the REST `POST` and
   * the socket's `message_send` handler go through (#65). Two write paths
   * would be two places to forget an authorization check; the checks differ
   * per transport (guard vs `requirePost`), the write does not.
   *
   * `content` is already trimmed and length-checked by `SendMessageDto` (the
   * frame DTO extends it); the id and creation time both come from the
   * Snowflake the repository mints.
   */
  postMessage(
    channelId: bigint,
    authorId: bigint,
    content: string,
  ): Promise<Message> {
    return this.messages.create({ channelId, authorId, content });
  }

  /**
   * Resolves `post` for `(caller, channel)`, throwing exactly what
   * `RequireCapabilityGuard` would have thrown had this been an HTTP route —
   * the same `resolveCapability` decision and the same
   * `capabilityRefusalError` mapping.
   *
   * This exists for callers with **no guard in front of them**: the gateway's
   * event handlers (Nest guards on a controller do not run around a socket
   * handler the way they run on a route, so `@RequireCapability` would save
   * nothing there). REST routes keep using the guard; nothing on the HTTP
   * path calls this.
   *
   * The loading sequence mirrors the guard step for step — channel first
   * (there is no `:serverId` on the frame, so `channel.serverId` is what the
   * membership keys on), then the membership, owner short-circuit before any
   * channel-scoped table is read. The *rules* are not mirrored: they are
   * `resolveCapability`'s, single-homed.
   */
  async requirePost(channelId: bigint, userId: bigint): Promise<void> {
    const rawChannelId = channelId.toString();

    const channel = await this.channels.findById(channelId);

    if (channel === null) throw hiddenChannelError(rawChannelId);

    const membership = await this.memberships.findByServerAndUser(
      channel.serverId,
      userId,
    );

    // 404, not 403: a non-member of the server must not learn the id exists.
    if (membership === null) throw hiddenChannelError(rawChannelId);

    // The owner short-circuits before either channel-scoped table is read —
    // a channel can never lock an owner out (PRD section 5).
    if (membership.role === 'owner') return;

    const [isChannelMember, overrides] = await Promise.all([
      channel.isPrivate
        ? this.channelMembers.isMember(channelId, userId)
        : Promise.resolve(false),
      this.channelOverrides.findByChannelId(channelId),
    ]);

    const decision = resolveCapability(
      {
        role: membership.role,
        isPrivate: channel.isPrivate,
        isChannelMember,
        overrides,
      },
      'post',
    );

    if (!decision.allowed) {
      throw capabilityRefusalError(decision, 'post', rawChannelId);
    }
  }

  /**
   * Updates the content of an existing message. Three checks, in order:
   *
   * 1. **The message must exist.** A null from `findById` means the id is
   *    unknown — 404, not 403, because the caller learns nothing about a
   *    message that is not there.
   * 2. **The message must belong to the channel in the URL.** Without this,
   *    a caller who holds `post` in channel A could edit a message in channel
   *    B by putting B's message id in A's URL. This is the whole reason the
   *    nested route needs a check beyond what the guard provides.
   * 3. **The caller must be the author.** Nobody edits anybody else's message
   *    — not a moderator, not the server owner. `post` was already proved
   *    before this runs — by the guard on HTTP, by `requirePost` through the
   *    gateway — and editing is writing, so losing `post` freezes your
   *    history.
   *
   * A soft-deleted message is rejected with 400: the caller can see the
   * message exists (so 404 would be a lie), but resurrecting content after a
   * delete would defeat the delete.
   */
  async editMessage(
    channelId: bigint,
    messageId: bigint,
    callerId: bigint,
    content: string,
  ): Promise<Message> {
    const message = await this.messages.findById(messageId);

    if (message === null) {
      throw new NotFoundError('Message not found', {
        messageId: messageId.toString(),
      });
    }

    if (message.channelId !== channelId) {
      throw new NotFoundError('Message not found', {
        messageId: messageId.toString(),
      });
    }

    if (message.isDeleted) {
      throw new ValidationError('This message has been deleted', {
        messageId: messageId.toString(),
      });
    }

    if (message.authorId !== callerId) {
      throw new ForbiddenError("Cannot edit another user's message", {
        messageId: messageId.toString(),
        authorId: message.authorId.toString(),
      });
    }

    return this.messages.updateContent(messageId, content);
  }

  /**
   * Soft-deletes a message. This is the most authorization-complex method in
   * the chat service, because the capability that applies depends on the row
   * being deleted — something a single decorator cannot express.
   *
   * **The two-step check is deliberate:**
   *
   * 1. The route decorator uses `@RequireCapability('post')`, the weaker of
   *    the two capabilities. The guard — or `requirePost`, which the gateway
   *    calls because no guard wraps its handlers — has already resolved
   *    `post` before this method runs, including the owner short-circuit,
   *    the private-channel hiding rule, and channel overrides. This covers
   *    the "delete your own" case.
   * 2. For "delete someone else's", we re-resolve `delete_others` using the
   *    same `resolveCapability` path the guard uses. The guard cannot do this
   *    because it has not loaded the message — it does not know whether the
   *    caller is the author.
   *
   * The **owner** case needs no special code: `resolveCapability` short-
   * circuits `owner` to allowed before it reads anything, including private-
   * channel membership. Asserted in the contract suite rather than
   * reimplemented here.
   */
  async deleteMessage(
    channelId: bigint,
    messageId: bigint,
    callerId: bigint,
  ): Promise<void> {
    const message = await this.messages.findById(messageId);

    if (message === null) {
      throw new NotFoundError('Message not found', {
        messageId: messageId.toString(),
      });
    }

    if (message.channelId !== channelId) {
      throw new NotFoundError('Message not found', {
        messageId: messageId.toString(),
      });
    }

    // The author always owns the right to retract their own message — the
    // guard already proved `post`, which is the required capability.
    if (message.authorId === callerId) {
      await this.messages.softDelete(messageId);
      return;
    }

    // Not the author: re-resolve `delete_others` for this caller in this
    // channel. This is the same path RequireCapabilityGuard uses, so the
    // owner short-circuit, the private-channel hiding rule, and channel
    // overrides all apply identically.
    const channel = await this.channels.findById(channelId);

    // The channel was verified by the guard moments ago; if it is gone now,
    // the write would also fail. Surface the same 404 the guard would have.
    if (channel === null) {
      throw new NotFoundError('Channel not found', {
        channelId: channelId.toString(),
      });
    }

    const membership = await this.memberships.findByServerAndUser(
      channel.serverId,
      callerId,
    );

    if (membership === null) {
      throw new NotFoundError('Channel not found', {
        channelId: channelId.toString(),
      });
    }

    const [isChannelMember, overrides] = await Promise.all([
      channel.isPrivate
        ? this.channelMembers.isMember(channelId, callerId)
        : Promise.resolve(false),
      this.channelOverrides.findByChannelId(channelId),
    ]);

    const decision = resolveCapability(
      {
        role: membership.role,
        isPrivate: channel.isPrivate,
        isChannelMember,
        overrides,
      },
      'delete_others',
    );

    if (!decision.allowed) {
      throw new ForbiddenError('Insufficient capability', {
        capability: 'delete_others',
      });
    }

    await this.messages.softDelete(messageId);
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
