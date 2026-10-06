import { ChannelRepository } from '../../src/administration/channel-repository.interface';
import {
  CreateServerInput,
  ServerRepository,
} from '../../src/administration/server-repository.interface';
import { ConflictError, NotFoundError } from '../../src/common/errors';

const HUDDLE_HQ: CreateServerInput = {
  name: 'Huddle HQ',
  iconUrl: null,
  channelCreationPolicy: 'everyone',
  memberInviteToggle: true,
};

const SIDE_PROJECT: CreateServerInput = {
  name: 'Side Project',
  iconUrl: null,
  channelCreationPolicy: 'owner_only',
  memberInviteToggle: false,
};

/**
 * The owner these cases seat. The Prisma integration spec seeds a real `User`
 * row for this id before each case, since unlike the fakes, real Postgres
 * enforces `Membership.userId`'s foreign key.
 */
export const CHANNEL_OWNER_ID = 320000000000000001n;

/** A channel id no row holds — for the "not found" cases. */
const NO_SUCH_CHANNEL = 999000000000000003n;

/** A server id no row holds — for the bulk read's empty-answer case. */
const NO_SUCH_SERVER = 999000000000000004n;

/**
 * Both ports, because a `Channel` cannot exist on its own: `Channel.serverId`
 * is a real foreign key, so every case here needs a server to hang one off.
 */
export interface ChannelRepositoryFixture {
  channels: ChannelRepository;
  servers: ServerRepository;
}

/** Builds an empty pair of repositories for one test case. */
export type ChannelRepositoryFactory = () => Promise<ChannelRepositoryFixture>;

/**
 * The behaviour every `ChannelRepository` must have, run against both
 * `FakeChannelRepository` and `PrismaChannelRepository` — see
 * `user-repository.contract.ts` for why this shared-suite shape exists.
 */
export function describeChannelRepositoryContract(
  label: string,
  createRepositories: ChannelRepositoryFactory,
): void {
  describe(`ChannelRepository contract (${label})`, () => {
    let channels: ChannelRepository;
    let servers: ServerRepository;

    beforeEach(async () => {
      ({ channels, servers } = await createRepositories());
    });

    /** A server to hang channels off, with its owner already seated. */
    async function seedServer(
      input: CreateServerInput = HUDDLE_HQ,
    ): Promise<bigint> {
      const { server } = await servers.createWithOwner(input, CHANNEL_OWNER_ID);

      return server.id;
    }

    describe('create', () => {
      it('creates a channel and mints its id', async () => {
        const serverId = await seedServer();

        const channel = await channels.create({
          serverId,
          name: 'general',
          isPrivate: false,
        });

        expect(channel).toMatchObject({
          serverId,
          name: 'general',
          isPrivate: false,
        });
        expect(typeof channel.id).toBe('bigint');
        expect(channel.createdAt).toBeInstanceOf(Date);
      });

      it('gives two channels different ids', async () => {
        const serverId = await seedServer();

        const first = await channels.create({
          serverId,
          name: 'general',
          isPrivate: false,
        });
        const second = await channels.create({
          serverId,
          name: 'random',
          isPrivate: false,
        });

        expect(first.id).not.toBe(second.id);
      });

      it('rejects a duplicate name in the same server with ConflictError', async () => {
        const serverId = await seedServer();
        await channels.create({ serverId, name: 'general', isPrivate: false });

        await expect(
          channels.create({ serverId, name: 'general', isPrivate: true }),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      it('allows the same name in a different server', async () => {
        const first = await seedServer(HUDDLE_HQ);
        const second = await seedServer(SIDE_PROJECT);
        await channels.create({
          serverId: first,
          name: 'general',
          isPrivate: false,
        });

        // UNIQUE (serverId, name) is scoped to the server, not global --
        // data-model.md section 4.4. Two servers each having a #general is
        // the normal case, not a conflict.
        const twin = await channels.create({
          serverId: second,
          name: 'general',
          isPrivate: false,
        });

        expect(twin.serverId).toBe(second);
      });

      it('creates a private channel without seating anyone', async () => {
        const serverId = await seedServer();

        const channel = await channels.create({
          serverId,
          name: 'mods-only',
          isPrivate: true,
        });

        expect(channel.isPrivate).toBe(true);
      });
    });

    describe('findById', () => {
      it('finds a channel that was created', async () => {
        const serverId = await seedServer();
        const created = await channels.create({
          serverId,
          name: 'general',
          isPrivate: false,
        });

        await expect(channels.findById(created.id)).resolves.toEqual(created);
      });

      it('returns null for an id nobody holds', async () => {
        await expect(channels.findById(NO_SUCH_CHANNEL)).resolves.toBeNull();
      });
    });

    describe('findByServerId', () => {
      it('returns every channel in the server, private ones included', async () => {
        const serverId = await seedServer();
        await channels.create({ serverId, name: 'general', isPrivate: false });
        await channels.create({ serverId, name: 'mods', isPrivate: true });

        const found = await channels.findByServerId(serverId);

        expect(found.map((channel) => channel.name).sort()).toEqual([
          'general',
          'mods',
        ]);
      });

      it('does not return channels belonging to another server', async () => {
        const mine = await seedServer(HUDDLE_HQ);
        const theirs = await seedServer(SIDE_PROJECT);
        await channels.create({
          serverId: theirs,
          name: 'general',
          isPrivate: false,
        });

        await expect(channels.findByServerId(mine)).resolves.toEqual([]);
      });

      it('returns an empty array for a server with no channels', async () => {
        const serverId = await seedServer();

        await expect(channels.findByServerId(serverId)).resolves.toEqual([]);
      });
    });

    describe('findByServerIds', () => {
      it('returns channels across several servers at once, private included', async () => {
        const mine = await seedServer(HUDDLE_HQ);
        const theirs = await seedServer(SIDE_PROJECT);
        await channels.create({
          serverId: mine,
          name: 'general',
          isPrivate: false,
        });
        await channels.create({
          serverId: mine,
          name: 'mods',
          isPrivate: true,
        });
        await channels.create({
          serverId: theirs,
          name: 'their-general',
          isPrivate: false,
        });

        const found = await channels.findByServerIds([mine, theirs]);

        expect(found.map((channel) => channel.name).sort()).toEqual([
          'general',
          'mods',
          'their-general',
        ]);
      });

      it('excludes channels of servers not named', async () => {
        const mine = await seedServer(HUDDLE_HQ);
        const theirs = await seedServer(SIDE_PROJECT);
        await channels.create({
          serverId: theirs,
          name: 'their-general',
          isPrivate: false,
        });

        await expect(channels.findByServerIds([mine])).resolves.toEqual([]);
      });

      it('returns channels oldest first, by id', async () => {
        const mine = await seedServer(HUDDLE_HQ);
        const first = await channels.create({
          serverId: mine,
          name: 'first',
          isPrivate: false,
        });
        const second = await channels.create({
          serverId: mine,
          name: 'second',
          isPrivate: false,
        });

        const found = await channels.findByServerIds([mine]);

        expect(found.map((channel) => channel.id)).toEqual([
          first.id,
          second.id,
        ]);
      });

      it('answers an empty serverIds with an empty array', async () => {
        const mine = await seedServer(HUDDLE_HQ);
        await channels.create({
          serverId: mine,
          name: 'general',
          isPrivate: false,
        });

        await expect(channels.findByServerIds([])).resolves.toEqual([]);
      });

      it('answers ids no server holds with an empty array', async () => {
        await expect(
          channels.findByServerIds([NO_SUCH_SERVER]),
        ).resolves.toEqual([]);
      });
    });

    describe('update', () => {
      it('applies a partial update, leaving other fields untouched', async () => {
        const serverId = await seedServer();
        const created = await channels.create({
          serverId,
          name: 'general',
          isPrivate: false,
        });

        const updated = await channels.update(created.id, { name: 'lobby' });

        expect(updated).toMatchObject({
          id: created.id,
          serverId,
          name: 'lobby',
          isPrivate: false,
        });
        await expect(channels.findById(created.id)).resolves.toEqual(updated);
      });

      it('toggles visibility', async () => {
        const serverId = await seedServer();
        const created = await channels.create({
          serverId,
          name: 'general',
          isPrivate: false,
        });

        const updated = await channels.update(created.id, { isPrivate: true });

        expect(updated.isPrivate).toBe(true);
      });

      it('rejects renaming onto a name the server already holds', async () => {
        const serverId = await seedServer();
        await channels.create({ serverId, name: 'general', isPrivate: false });
        const other = await channels.create({
          serverId,
          name: 'random',
          isPrivate: false,
        });

        await expect(
          channels.update(other.id, { name: 'general' }),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      it('rejects an id nobody holds', async () => {
        await expect(
          channels.update(NO_SUCH_CHANNEL, { name: 'nope' }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe('delete', () => {
      it('removes the channel, then findById returns null', async () => {
        const serverId = await seedServer();
        const created = await channels.create({
          serverId,
          name: 'general',
          isPrivate: false,
        });

        await channels.delete(created.id);

        await expect(channels.findById(created.id)).resolves.toBeNull();
      });

      it('frees the name for reuse in that server', async () => {
        const serverId = await seedServer();
        const created = await channels.create({
          serverId,
          name: 'general',
          isPrivate: false,
        });
        await channels.delete(created.id);

        const remade = await channels.create({
          serverId,
          name: 'general',
          isPrivate: false,
        });

        expect(remade.id).not.toBe(created.id);
      });

      it('rejects an id nobody holds', async () => {
        await expect(channels.delete(NO_SUCH_CHANNEL)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });
    });
  });
}
