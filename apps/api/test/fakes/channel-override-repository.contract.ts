import { ChannelOverrideRepository } from '../../src/administration/channel-override-repository.interface';
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
 * The owner these cases seat. The Prisma integration spec seeds a real `User`
 * row for this id before each case, since unlike the fakes, real Postgres
 * enforces `Membership.userId`'s foreign key.
 */
export const CHANNEL_OVERRIDE_OWNER_ID = 340000000000000001n;

/** A channel id no row holds — for the bulk-read cases. */
const NO_SUCH_CHANNEL = 999000000000000005n;

/**
 * Three ports, because a `ChannelOverride` cannot exist on its own: it needs
 * a real `Channel`, which needs a real `Server`.
 */
export interface ChannelOverrideRepositoryFixture {
  overrides: ChannelOverrideRepository;
  channels: ChannelRepository;
  servers: ServerRepository;
}

export type ChannelOverrideRepositoryFactory =
  () => Promise<ChannelOverrideRepositoryFixture>;

/**
 * The behaviour every `ChannelOverrideRepository` must have, run against both
 * `FakeChannelOverrideRepository` and `PrismaChannelOverrideRepository` — see
 * `user-repository.contract.ts` for why this shared-suite shape exists.
 */
export function describeChannelOverrideRepositoryContract(
  label: string,
  createRepositories: ChannelOverrideRepositoryFactory,
): void {
  describe(`ChannelOverrideRepository contract (${label})`, () => {
    let overrides: ChannelOverrideRepository;
    let channels: ChannelRepository;
    let servers: ServerRepository;
    let serverId: bigint;

    beforeEach(async () => {
      ({ overrides, channels, servers } = await createRepositories());
      const { server } = await servers.createWithOwner(
        HUDDLE_HQ,
        CHANNEL_OVERRIDE_OWNER_ID,
      );
      serverId = server.id;
    });

    async function seedChannel(name: string): Promise<bigint> {
      const channel = await channels.create({
        serverId,
        name,
        isPrivate: false,
      });

      return channel.id;
    }

    describe('revoke', () => {
      it('records the revocation as a row', async () => {
        const channelId = await seedChannel('general');

        await overrides.revoke(channelId, 'member', 'post');

        // The row existing IS the revocation -- there is no value to read
        // back, so its presence is the whole assertion.
        await expect(overrides.findByChannelId(channelId)).resolves.toEqual([
          { channelId, role: 'member', capability: 'post' },
        ]);
      });

      it('is idempotent: revoking twice leaves exactly one row', async () => {
        const channelId = await seedChannel('general');

        await overrides.revoke(channelId, 'member', 'post');
        await overrides.revoke(channelId, 'member', 'post');

        await expect(
          overrides.findByChannelId(channelId),
        ).resolves.toHaveLength(1);
      });

      it('keeps revocations for different roles and capabilities apart', async () => {
        const channelId = await seedChannel('general');

        await overrides.revoke(channelId, 'member', 'post');
        await overrides.revoke(channelId, 'moderator', 'post');
        await overrides.revoke(channelId, 'member', 'view');

        await expect(
          overrides.findByChannelId(channelId),
        ).resolves.toHaveLength(3);
      });
    });

    describe('restore', () => {
      it('removes the revocation, so the role inherits the default again', async () => {
        const channelId = await seedChannel('general');
        await overrides.revoke(channelId, 'member', 'post');

        await overrides.restore(channelId, 'member', 'post');

        await expect(overrides.findByChannelId(channelId)).resolves.toEqual([]);
      });

      it('does not throw for a revocation that was never made', async () => {
        const channelId = await seedChannel('general');

        await expect(
          overrides.restore(channelId, 'member', 'post'),
        ).resolves.toBeUndefined();
      });

      it('leaves the other revocations on the channel alone', async () => {
        const channelId = await seedChannel('general');
        await overrides.revoke(channelId, 'member', 'post');
        await overrides.revoke(channelId, 'moderator', 'delete_others');

        await overrides.restore(channelId, 'member', 'post');

        await expect(overrides.findByChannelId(channelId)).resolves.toEqual([
          { channelId, role: 'moderator', capability: 'delete_others' },
        ]);
      });
    });

    describe('findByChannelId', () => {
      it('returns an empty array for a channel with no revocations', async () => {
        const channelId = await seedChannel('general');

        await expect(overrides.findByChannelId(channelId)).resolves.toEqual([]);
      });

      it('does not return another channel’s revocations', async () => {
        const mine = await seedChannel('general');
        const other = await seedChannel('random');
        await overrides.revoke(other, 'member', 'post');

        await expect(overrides.findByChannelId(mine)).resolves.toEqual([]);
      });
    });

    describe('findByChannelIds', () => {
      it('returns an empty array for an empty id list', async () => {
        await expect(overrides.findByChannelIds([])).resolves.toEqual([]);
      });

      it('returns the rows for a single id', async () => {
        const channelId = await seedChannel('general');
        await overrides.revoke(channelId, 'member', 'post');

        await expect(overrides.findByChannelIds([channelId])).resolves.toEqual([
          { channelId, role: 'member', capability: 'post' },
        ]);
      });

      it('returns rows across several ids, including one with none', async () => {
        const first = await seedChannel('general');
        const second = await seedChannel('random');
        const bare = await seedChannel('quiet');
        await overrides.revoke(first, 'member', 'post');
        await overrides.revoke(second, 'moderator', 'manage_settings');

        const found = await overrides.findByChannelIds([
          first,
          second,
          bare,
          NO_SUCH_CHANNEL,
        ]);

        // The channel with no rows and the id nobody holds contribute
        // nothing, rather than a null or a placeholder.
        expect(found).toHaveLength(2);
        expect(found.map((override) => override.channelId).sort()).toEqual(
          [first, second].sort(),
        );
      });
    });
  });
}
