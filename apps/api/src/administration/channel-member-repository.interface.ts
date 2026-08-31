/**
 * A user's membership of a *private* channel.
 *
 * Declared here rather than re-exported from the generated Prisma client on
 * purpose: the port is the line the vendor stops at (AGENTS.md section 2).
 *
 * Rows exist for private channels only. A public channel has no rows here at
 * all — visibility there is implied by server membership (data-model.md
 * section 4.5). So `isMember` returning `false` is not by itself "no access";
 * it is one input to `resolveCapability`, which only consults it when the
 * channel is private.
 */
export interface ChannelMember {
  channelId: bigint;
  userId: bigint;
  addedAt: Date;
}

/**
 * Persistence for private-channel membership.
 *
 * An abstract class, never a TypeScript `interface`: Nest binds DI against a
 * runtime token, and an interface is erased at compile time. See
 * docs/architecture/repo-structure.md section 3.
 */
export abstract class ChannelMemberRepository {
  /**
   * Seats a user in a channel, idempotently.
   *
   * Re-adding someone who is already in returns the **existing** row
   * unchanged, `addedAt` included, rather than throwing: adding a member
   * twice is not a failure, and sliding the timestamp forward would quietly
   * rewrite when they joined. Same reasoning as `InviteRepository.revoke`.
   */
  abstract add(channelId: bigint, userId: bigint): Promise<ChannelMember>;

  /**
   * Removes a user from a channel, idempotently. Removing someone who is not
   * in the channel does not throw — the caller asked for an end state, and
   * that end state already holds.
   */
  abstract remove(channelId: bigint, userId: bigint): Promise<void>;

  /** Everyone seated in this channel. */
  abstract findByChannelId(channelId: bigint): Promise<ChannelMember[]>;

  /**
   * Filters `channelIds` down to the ones this user holds a row in.
   *
   * The name follows the ticket, but read the signature rather than the name:
   * this does *not* return every channel the user belongs to. It answers
   * "which of these" for a list the caller already has.
   *
   * It exists so a whole server's channel list can be filtered in one query
   * instead of one `isMember` call per channel — the read the channel listing
   * makes on every request. An empty input list makes no query at all.
   */
  abstract findChannelIdsForUser(
    channelIds: bigint[],
    userId: bigint,
  ): Promise<Set<bigint>>;

  /**
   * Whether this user is seated in this channel.
   *
   * Its own method rather than `findByChannelId(...).some(...)`: the
   * capability guard asks this on every private-channel request and has no
   * use for the full member list.
   */
  abstract isMember(channelId: bigint, userId: bigint): Promise<boolean>;
}
