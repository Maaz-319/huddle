import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaMembershipRepository } from '../src/administration/adapters/prisma-membership-repository.adapter';
import { PrismaServerRepository } from '../src/administration/adapters/prisma-server-repository.adapter';
import { MembershipRepository } from '../src/administration/membership-repository.interface';
import { ServerRepository } from '../src/administration/server-repository.interface';
import { PrismaService } from '../src/common/prisma.service';
import { SnowflakeService } from '../src/common/snowflake.service';
import {
  describeMembershipRepositoryContract,
  OTHER_SERVER_ID,
  OTHER_USER_ID,
  SERVER_ID,
  USER_ID,
} from './fakes/membership-repository.contract';
import {
  describeServerRepositoryContract,
  OWNER_ID,
} from './fakes/server-repository.contract';
import { TEST_DATABASE_URL, truncateAll } from './prisma-test-client';

/** A minimal, valid `User` row for a given id — Membership's FK just needs it to exist. */
function userFixture(id: bigint) {
  return {
    id,
    githubId: id.toString(),
    username: `user-${id}`,
    avatarUrl: 'https://example.test/avatar.png',
    email: `user-${id}@example.test`,
  };
}

/** A minimal, valid `Server` row for a given id — Membership's FK just needs it to exist. */
function serverFixture(id: bigint) {
  return {
    id,
    name: `server-${id}`,
    channelCreationPolicy: 'everyone' as const,
    memberInviteToggle: true,
  };
}

const GENERAL = {
  name: 'General Chat',
  iconUrl: 'https://example.test/general.png',
  channelCreationPolicy: 'everyone' as const,
  memberInviteToggle: true,
};

/**
 * The reference adapters against real Docker Postgres. The contract suites
 * are the same ones the fakes are held to; the cases below are the ones a
 * `Map` cannot express — real foreign keys, real transaction rollback.
 */
describe('PrismaServerRepository / PrismaMembershipRepository', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let servers: ServerRepository;
  let memberships: MembershipRepository;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        SnowflakeService,
        // Never DATABASE_URL: these cases TRUNCATE, so they must be
        // incapable of reaching the development database.
        { provide: ConfigService, useValue: { get: () => TEST_DATABASE_URL } },
        { provide: ServerRepository, useClass: PrismaServerRepository },
        { provide: MembershipRepository, useClass: PrismaMembershipRepository },
      ],
    }).compile();

    await module.init();
    prisma = module.get(PrismaService);
    servers = module.get(ServerRepository);
    memberships = module.get(MembershipRepository);
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves the port tokens to the Prisma adapters', () => {
    expect(servers).toBeInstanceOf(PrismaServerRepository);
    expect(memberships).toBeInstanceOf(PrismaMembershipRepository);
  });

  describeServerRepositoryContract('PrismaServerRepository', async () => {
    await truncateAll(prisma);
    // createWithOwner seats OWNER_ID as owner — a real foreign key, unlike
    // the fake, so the row has to actually exist first.
    await prisma.user.create({ data: userFixture(OWNER_ID) });
    return servers;
  });

  describeMembershipRepositoryContract(
    'PrismaMembershipRepository',
    async () => {
      await truncateAll(prisma);
      // Membership.userId/serverId are real foreign keys, unlike the fake, so
      // every id the contract's cases use has to actually exist first.
      await prisma.user.createMany({
        data: [userFixture(USER_ID), userFixture(OTHER_USER_ID)],
      });
      await prisma.server.createMany({
        data: [serverFixture(SERVER_ID), serverFixture(OTHER_SERVER_ID)],
      });
      return memberships;
    },
  );

  describe('behaviour that needs a real database', () => {
    beforeEach(async () => {
      await truncateAll(prisma);
    });

    it('createWithOwner leaves neither row behind when the owner does not exist', async () => {
      const NO_SUCH_USER = 999000000000000001n;

      await expect(
        servers.createWithOwner(GENERAL, NO_SUCH_USER),
      ).rejects.toThrow();

      await expect(prisma.server.findMany()).resolves.toEqual([]);
      await expect(prisma.membership.findMany()).resolves.toEqual([]);
    });

    it('mints server ids as bigint, never as a number', async () => {
      const created = await servers.create(GENERAL);

      const row = await prisma.server.findUniqueOrThrow({
        where: { id: created.id },
      });

      expect(typeof row.id).toBe('bigint');
      expect(row.id).toBe(created.id);
    });

    it('transferOwnership leaves exactly one owner row for the server', async () => {
      await prisma.user.createMany({
        data: [userFixture(USER_ID), userFixture(OTHER_USER_ID)],
      });
      await prisma.server.create({ data: serverFixture(SERVER_ID) });
      await prisma.membership.createMany({
        data: [
          { serverId: SERVER_ID, userId: USER_ID, role: 'owner' },
          { serverId: SERVER_ID, userId: OTHER_USER_ID, role: 'member' },
        ],
      });

      await memberships.transferOwnership(SERVER_ID, USER_ID, OTHER_USER_ID);

      // The load-bearing invariant the partial unique index exists for
      // (data-model.md section 4.3): a direct count, not just the port's own
      // findByServerAndUser reads, confirms the transaction never leaves the
      // server with zero or two owners.
      await expect(
        prisma.membership.count({
          where: { serverId: SERVER_ID, role: 'owner' },
        }),
      ).resolves.toBe(1);
    });
  });
});
