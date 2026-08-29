import {
  CreateServerInput,
  ServerRepository,
} from '../../src/administration/server-repository.interface';
import { isSnowflakeString } from '../../src/common/snowflake.service';

const GENERAL: CreateServerInput = {
  name: 'General Chat',
  iconUrl: 'https://example.test/general.png',
  channelCreationPolicy: 'everyone',
  memberInviteToggle: true,
};

const STUDY_GROUP: CreateServerInput = {
  name: 'Study Group',
  iconUrl: null,
  channelCreationPolicy: 'owner_only',
  memberInviteToggle: false,
};

/**
 * A fixed id `createWithOwner`'s cases seat as owner. The Prisma integration
 * spec seeds a real `User` row for exactly this id before each case, since
 * unlike the fake, real Postgres enforces `Membership.userId`'s foreign key.
 */
export const OWNER_ID = 300000000000000001n;

/**
 * Builds an empty repository for one test case. The integration suite
 * truncates the database here; the fake suite just constructs a new one.
 */
export type ServerRepositoryFactory = () => Promise<ServerRepository>;

/**
 * The behaviour every `ServerRepository` must have, run against both
 * `FakeServerRepository` and `PrismaServerRepository` — see
 * `user-repository.contract.ts` for why this shared-suite shape exists.
 */
export function describeServerRepositoryContract(
  label: string,
  createRepository: ServerRepositoryFactory,
): void {
  describe(`ServerRepository contract (${label})`, () => {
    let servers: ServerRepository;

    beforeEach(async () => {
      servers = await createRepository();
    });

    describe('create', () => {
      it('returns the input with a freshly minted Snowflake id', async () => {
        const created = await servers.create(GENERAL);

        expect(created).toMatchObject(GENERAL);
        expect(typeof created.id).toBe('bigint');
        expect(isSnowflakeString(created.id.toString())).toBe(true);
      });

      it('gives two servers different ids', async () => {
        const first = await servers.create(GENERAL);
        const second = await servers.create(STUDY_GROUP);

        expect(first.id).not.toBe(second.id);
      });
    });

    describe('createWithOwner', () => {
      it('creates the server and seats the owner', async () => {
        const { server, membership } = await servers.createWithOwner(
          GENERAL,
          OWNER_ID,
        );

        expect(server).toMatchObject(GENERAL);
        expect(membership).toMatchObject({
          serverId: server.id,
          userId: OWNER_ID,
          role: 'owner',
        });
      });

      it('the created server is then findable', async () => {
        const { server } = await servers.createWithOwner(GENERAL, OWNER_ID);

        await expect(servers.findById(server.id)).resolves.toEqual(server);
      });
    });

    describe('findById', () => {
      it('finds a server that was created', async () => {
        const created = await servers.create(GENERAL);

        await expect(servers.findById(created.id)).resolves.toEqual(created);
      });

      it('returns null for an id nobody holds', async () => {
        await servers.create(GENERAL);

        await expect(servers.findById(999000000000000001n)).resolves.toBeNull();
      });
    });
  });
}
