import {
  ChannelMember,
  ChannelMemberRepository,
} from '../../src/administration/channel-member-repository.interface';
import {
  channelMemberKey,
  FakeAdministrationStore,
} from './fake-administration-store';

/**
 * In-memory `ChannelMemberRepository`.
 *
 * `extends ChannelMemberRepository` rather than duck-typing it, same
 * reasoning as `FakeServerRepository`'s own doc: a method added to the port
 * then breaks compilation here.
 */
export class FakeChannelMemberRepository extends ChannelMemberRepository {
  constructor(private readonly store: FakeAdministrationStore) {
    super();
  }

  add(channelId: bigint, userId: bigint): Promise<ChannelMember> {
    const key = channelMemberKey(channelId, userId);
    const existing = this.store.channelMembers.get(key);

    // Idempotent, and deliberately returns the original addedAt rather than
    // a fresh one -- see the port's own doc.
    if (existing !== undefined) return Promise.resolve({ ...existing });

    const member: ChannelMember = { channelId, userId, addedAt: new Date() };
    this.store.channelMembers.set(key, member);

    return Promise.resolve({ ...member });
  }

  remove(channelId: bigint, userId: bigint): Promise<void> {
    this.store.channelMembers.delete(channelMemberKey(channelId, userId));

    return Promise.resolve();
  }

  findByChannelId(channelId: bigint): Promise<ChannelMember[]> {
    const members = [...this.store.channelMembers.values()]
      .filter((member) => member.channelId === channelId)
      .map((member) => ({ ...member }));

    return Promise.resolve(members);
  }

  findChannelIdsForUser(
    channelIds: bigint[],
    userId: bigint,
  ): Promise<Set<bigint>> {
    const held = channelIds.filter((channelId) =>
      this.store.channelMembers.has(channelMemberKey(channelId, userId)),
    );

    return Promise.resolve(new Set(held));
  }

  isMember(channelId: bigint, userId: bigint): Promise<boolean> {
    return Promise.resolve(
      this.store.channelMembers.has(channelMemberKey(channelId, userId)),
    );
  }
}
