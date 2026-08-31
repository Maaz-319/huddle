import { ChannelMemberRepository } from '../../src/administration/channel-member-repository.interface';
import { ChannelRepository } from '../../src/administration/channel-repository.interface';
import {
  CreateServerInput,
  ServerRepository,
} from '../../src/administration/server-repository.interface';

const HUDDLE_HQ: CreateServerInput = {
  name: 'Huddle HQ',
  iconUrl: null,
  channelCreationPolicy: 'everyone',
  memberInviteToggle: true,
};

/**
 * The users these cases seat. The Prisma integration spec seeds real `User`
 * rows for both before each case, since unlike the fakes, real Postgres
 * enforces `ChannelMember.userId`'s foreign key.
 */
export const CHANNEL_MEMBER_OWNER_ID = 330000000000000001n;
export const CHANNEL_MEMBER_OTHER_ID = 330000000000000002n;

/** A channel id no row holds — for the bulk-read cases. */
const NO_SUCH_CHANNEL = 999000000000000004n;

/**
 * Three ports, because a `ChannelMember` cannot exist on its own: it needs a
 * real `Channel`, which needs a real `Server`.
 */
export interface ChannelMemberRepositoryFixture {
  channelMembers: ChannelMemberRepository;
  channels: ChannelRepository;
  servers: ServerRepository;
}

export type ChannelMemberRepositoryFactory =
  () => Promise<ChannelMemberRepositoryFixture>;

/**
 * The behaviour every `ChannelMemberRepository` must have, run against both
 * `FakeChannelMemberRepository` and `PrismaChannelMemberRepository` — see
 * `user-repository.contract.ts` for why this shared-suite shape exists.
 */
export function describeChannelMemberRepositoryContract(
  label: string,
  createRepositories: ChannelMemberRepositoryFactory,
): void {
  describe(`ChannelMemberRepository contract (${label})`, () => {
    let channelMembers: ChannelMemberRepository;
    let channels: ChannelRepository;
    let servers: ServerRepository;
    let serverId: bigint;

    beforeEach(async () => {
      ({ channelMembers, channels, servers } = await createRepositories());
      const { server } = await servers.createWithOwner(
        HUDDLE_HQ,
        CHANNEL_MEMBER_OWNER_ID,
      );
      serverId = server.id;
    });

    /** A private channel to seat people in. */
    async function seedChannel(name: string): Promise<bigint> {
      const channel = await channels.create({
        serverId,
        name,
        isPrivate: true,
      });

      return channel.id;
    }

    describe('add', () => {
      it('seats a user', async () => {
        const channelId = await seedChannel('mods');

        const member = await channelMembers.add(
          channelId,
          CHANNEL_MEMBER_OWNER_ID,
        );

        expect(member).toMatchObject({
          channelId,
          userId: CHANNEL_MEMBER_OWNER_ID,
        });
        expect(member.addedAt).toBeInstanceOf(Date);
      });

      it('is idempotent, returning the existing row with its original addedAt', async () => {
        const channelId = await seedChannel('mods');
        const first = await channelMembers.add(
          channelId,
          CHANNEL_MEMBER_OWNER_ID,
        );

        const second = await channelMembers.add(
          channelId,
          CHANNEL_MEMBER_OWNER_ID,
        );

        // Not just "did not throw": re-adding must not slide addedAt forward,
        // which would quietly rewrite when the person joined.
        expect(second.addedAt).toEqual(first.addedAt);
        await expect(
          channelMembers.findByChannelId(channelId),
        ).resolves.toHaveLength(1);
      });
    });

    describe('remove', () => {
      it('unseats a user', async () => {
        const channelId = await seedChannel('mods');
        await channelMembers.add(channelId, CHANNEL_MEMBER_OWNER_ID);

        await channelMembers.remove(channelId, CHANNEL_MEMBER_OWNER_ID);

        await expect(
          channelMembers.isMember(channelId, CHANNEL_MEMBER_OWNER_ID),
        ).resolves.toBe(false);
      });

      it('does not throw for someone who was never seated', async () => {
        const channelId = await seedChannel('mods');

        await expect(
          channelMembers.remove(channelId, CHANNEL_MEMBER_OTHER_ID),
        ).resolves.toBeUndefined();
      });

      it('is idempotent across repeated calls', async () => {
        const channelId = await seedChannel('mods');
        await channelMembers.add(channelId, CHANNEL_MEMBER_OWNER_ID);
        await channelMembers.remove(channelId, CHANNEL_MEMBER_OWNER_ID);

        await expect(
          channelMembers.remove(channelId, CHANNEL_MEMBER_OWNER_ID),
        ).resolves.toBeUndefined();
      });
    });

    describe('findByChannelId', () => {
      it('returns everyone seated in that channel and nobody else', async () => {
        const mine = await seedChannel('mods');
        const other = await seedChannel('secret');
        await channelMembers.add(mine, CHANNEL_MEMBER_OWNER_ID);
        await channelMembers.add(mine, CHANNEL_MEMBER_OTHER_ID);
        await channelMembers.add(other, CHANNEL_MEMBER_OTHER_ID);

        const found = await channelMembers.findByChannelId(mine);

        expect(found.map((member) => member.userId).sort()).toEqual(
          [CHANNEL_MEMBER_OWNER_ID, CHANNEL_MEMBER_OTHER_ID].sort(),
        );
      });

      it('returns an empty array for a channel nobody is in', async () => {
        const channelId = await seedChannel('mods');

        await expect(
          channelMembers.findByChannelId(channelId),
        ).resolves.toEqual([]);
      });
    });

    describe('isMember', () => {
      it('is true for a seated user and false for anyone else', async () => {
        const channelId = await seedChannel('mods');
        await channelMembers.add(channelId, CHANNEL_MEMBER_OWNER_ID);

        await expect(
          channelMembers.isMember(channelId, CHANNEL_MEMBER_OWNER_ID),
        ).resolves.toBe(true);
        await expect(
          channelMembers.isMember(channelId, CHANNEL_MEMBER_OTHER_ID),
        ).resolves.toBe(false);
      });
    });

    describe('findChannelIdsForUser', () => {
      it('returns an empty set for an empty id list', async () => {
        await expect(
          channelMembers.findChannelIdsForUser([], CHANNEL_MEMBER_OWNER_ID),
        ).resolves.toEqual(new Set());
      });

      it('returns the single id when the user holds it', async () => {
        const channelId = await seedChannel('mods');
        await channelMembers.add(channelId, CHANNEL_MEMBER_OWNER_ID);

        await expect(
          channelMembers.findChannelIdsForUser(
            [channelId],
            CHANNEL_MEMBER_OWNER_ID,
          ),
        ).resolves.toEqual(new Set([channelId]));
      });

      it('returns an empty set when the single id has no row for that user', async () => {
        const channelId = await seedChannel('mods');
        await channelMembers.add(channelId, CHANNEL_MEMBER_OTHER_ID);

        await expect(
          channelMembers.findChannelIdsForUser(
            [channelId],
            CHANNEL_MEMBER_OWNER_ID,
          ),
        ).resolves.toEqual(new Set());
      });

      it('filters several ids down to the ones held, dropping the rest', async () => {
        const held = await seedChannel('mods');
        const someoneElses = await seedChannel('secret');
        const empty = await seedChannel('empty');
        await channelMembers.add(held, CHANNEL_MEMBER_OWNER_ID);
        await channelMembers.add(someoneElses, CHANNEL_MEMBER_OTHER_ID);

        const found = await channelMembers.findChannelIdsForUser(
          [held, someoneElses, empty, NO_SUCH_CHANNEL],
          CHANNEL_MEMBER_OWNER_ID,
        );

        // Only the one the user actually holds -- a channel with no rows at
        // all and a channel held by someone else are both dropped.
        expect(found).toEqual(new Set([held]));
      });
    });
  });
}
