import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaChannelMemberRepository } from '../src/administration/adapters/prisma-channel-member-repository.adapter';
import { PrismaChannelOverrideRepository } from '../src/administration/adapters/prisma-channel-override-repository.adapter';
import { PrismaChannelRepository } from '../src/administration/adapters/prisma-channel-repository.adapter';
import { PrismaInviteRepository } from '../src/administration/adapters/prisma-invite-repository.adapter';
import { PrismaMembershipRepository } from '../src/administration/adapters/prisma-membership-repository.adapter';
import { PrismaServerRepository } from '../src/administration/adapters/prisma-server-repository.adapter';
import { ChannelMemberRepository } from '../src/administration/channel-member-repository.interface';
import { ChannelOverrideRepository } from '../src/administration/channel-override-repository.interface';
import { ChannelRepository } from '../src/administration/channel-repository.interface';
import { AdministrationService } from '../src/administration/administration.service';
import * as inviteCode from '../src/administration/invite-code';
import { InviteRepository } from '../src/administration/invite-repository.interface';
import { MembershipRepository } from '../src/administration/membership-repository.interface';
import { ServerRepository } from '../src/administration/server-repository.interface';
import { ConflictError } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma.service';
import { LoggerService } from '../src/common/logger.service';
import { SnowflakeService } from '../src/common/snowflake.service';
import {
  CHANNEL_MEMBER_OTHER_ID,
  CHANNEL_MEMBER_OWNER_ID,
  describeChannelMemberRepositoryContract,
} from './fakes/channel-member-repository.contract';
import {
  CHANNEL_OVERRIDE_OWNER_ID,
  describeChannelOverrideRepositoryContract,
} from './fakes/channel-override-repository.contract';
import {
  CHANNEL_OWNER_ID,
  describeChannelRepositoryContract,
} from './fakes/channel-repository.contract';
import {
  describeInviteRepositoryContract,
  INVITE_OWNER_ID,
} from './fakes/invite-repository.contract';
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
describe('the administration Prisma adapters', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let servers: ServerRepository;
  let memberships: MembershipRepository;
  let invites: InviteRepository;
  let channels: ChannelRepository;
  let channelMembers: ChannelMemberRepository;
  let channelOverrides: ChannelOverrideRepository;

  beforeAll(async () => {
    const mockLogger = {
      error: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      trace: jest.fn(),
      fatal: jest.fn(),
      setCorrelationId: jest.fn(),
      clearCorrelationId: jest.fn(),
      child: jest.fn(),
    } as unknown as LoggerService;

    module = await Test.createTestingModule({
      providers: [
        PrismaService,
        SnowflakeService,
        { provide: LoggerService, useValue: mockLogger },
        // Never DATABASE_URL: these cases TRUNCATE, so they must be
        // incapable of reaching the development database.
        { provide: ConfigService, useValue: { get: () => TEST_DATABASE_URL } },
        { provide: ServerRepository, useClass: PrismaServerRepository },
        { provide: MembershipRepository, useClass: PrismaMembershipRepository },
        { provide: InviteRepository, useClass: PrismaInviteRepository },
        { provide: ChannelRepository, useClass: PrismaChannelRepository },
        {
          provide: ChannelMemberRepository,
          useClass: PrismaChannelMemberRepository,
        },
        {
          provide: ChannelOverrideRepository,
          useClass: PrismaChannelOverrideRepository,
        },
      ],
    }).compile();

    await module.init();
    prisma = module.get(PrismaService);
    servers = module.get(ServerRepository);
    memberships = module.get(MembershipRepository);
    invites = module.get(InviteRepository);
    channels = module.get(ChannelRepository);
    channelMembers = module.get(ChannelMemberRepository);
    channelOverrides = module.get(ChannelOverrideRepository);
  });

  afterAll(async () => {
    await module.close();
  });

  it('resolves the port tokens to the Prisma adapters', () => {
    expect(servers).toBeInstanceOf(PrismaServerRepository);
    expect(memberships).toBeInstanceOf(PrismaMembershipRepository);
    expect(invites).toBeInstanceOf(PrismaInviteRepository);
    expect(channels).toBeInstanceOf(PrismaChannelRepository);
    expect(channelMembers).toBeInstanceOf(PrismaChannelMemberRepository);
    expect(channelOverrides).toBeInstanceOf(PrismaChannelOverrideRepository);
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

  describeInviteRepositoryContract('PrismaInviteRepository', async () => {
    await truncateAll(prisma);
    // createWithOwner seats INVITE_OWNER_ID as owner -- a real foreign key,
    // unlike the fake, so the row has to actually exist first.
    await prisma.user.create({ data: userFixture(INVITE_OWNER_ID) });
    return { invites, servers };
  });

  describeChannelRepositoryContract('PrismaChannelRepository', async () => {
    await truncateAll(prisma);
    // Channel.serverId is a real foreign key and the contract's servers are
    // seated via createWithOwner, so the owner row has to exist first.
    await prisma.user.create({ data: userFixture(CHANNEL_OWNER_ID) });
    return { channels, servers };
  });

  describeChannelMemberRepositoryContract(
    'PrismaChannelMemberRepository',
    async () => {
      await truncateAll(prisma);
      // ChannelMember.userId is a real foreign key, unlike the fake, so both
      // users the cases seat have to actually exist first.
      await prisma.user.createMany({
        data: [
          userFixture(CHANNEL_MEMBER_OWNER_ID),
          userFixture(CHANNEL_MEMBER_OTHER_ID),
        ],
      });
      return { channelMembers, channels, servers };
    },
  );

  describeChannelOverrideRepositoryContract(
    'PrismaChannelOverrideRepository',
    async () => {
      await truncateAll(prisma);
      await prisma.user.create({
        data: userFixture(CHANNEL_OVERRIDE_OWNER_ID),
      });
      return { overrides: channelOverrides, channels, servers };
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
      await expect(prisma.invite.findMany()).resolves.toEqual([]);
    });

    it('create mints no invite -- only createWithOwner does', async () => {
      // The ownerless variant seats nobody, so it deliberately does not mint a
      // code. Asserted rather than left implicit: the invite routes 404 for
      // such a server, and that has to be a decision, not an accident.
      const created = await servers.create(GENERAL);

      await expect(
        prisma.invite.findUnique({ where: { serverId: created.id } }),
      ).resolves.toBeNull();
    });

    it('deleting a channel cascades its members and overrides away', async () => {
      await prisma.user.create({ data: userFixture(OWNER_ID) });
      const { server } = await servers.createWithOwner(GENERAL, OWNER_ID);
      const channel = await channels.create({
        serverId: server.id,
        name: 'mods',
        isPrivate: true,
      });
      await channelMembers.add(channel.id, OWNER_ID);
      await channelOverrides.revoke(channel.id, 'member', 'post');

      await channels.delete(channel.id);

      // ChannelMember and ChannelOverride both cascade off Channel at the
      // schema level (data-model.md section 7). Verified rather than assumed:
      // without the referential action the delete would be rejected outright,
      // so a passing delete plus empty tables is the whole proof.
      await expect(prisma.channelMember.count()).resolves.toBe(0);
      await expect(prisma.channelOverride.count()).resolves.toBe(0);
    });

    it('deleting a server cascades its channels away', async () => {
      await prisma.user.create({ data: userFixture(OWNER_ID) });
      const { server } = await servers.createWithOwner(GENERAL, OWNER_ID);
      const channel = await channels.create({
        serverId: server.id,
        name: 'general',
        isPrivate: false,
      });

      await servers.delete(server.id);

      // Channel cascades off Server at the schema level (data-model.md
      // section 7). Without it the delete would be rejected outright, not
      // silently orphan rows -- so this asserts the referential action, not
      // just an absence.
      await expect(channels.findById(channel.id)).resolves.toBeNull();
    });

    it('rejects a duplicate channel name as ConflictError, not a raw Prisma error', async () => {
      await prisma.user.create({ data: userFixture(OWNER_ID) });
      const { server } = await servers.createWithOwner(GENERAL, OWNER_ID);
      await channels.create({
        serverId: server.id,
        name: 'general',
        isPrivate: false,
      });

      // The real UNIQUE (serverId, name) index, not the fake's scan. A raw
      // P2002 escaping here would surface as a 500 rather than a 409.
      await expect(
        channels.create({
          serverId: server.id,
          name: 'general',
          isPrivate: false,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('stores a channel id as a bigint', async () => {
      await prisma.user.create({ data: userFixture(OWNER_ID) });
      const { server } = await servers.createWithOwner(GENERAL, OWNER_ID);
      const channel = await channels.create({
        serverId: server.id,
        name: 'general',
        isPrivate: false,
      });

      const row = await prisma.channel.findUnique({
        where: { id: channel.id },
      });

      // A Number column would silently round a Snowflake rather than throw.
      expect(typeof row?.id).toBe('bigint');
      expect(typeof row?.serverId).toBe('bigint');
    });

    it('deleting a server cascades its invite away', async () => {
      await prisma.user.create({ data: userFixture(OWNER_ID) });
      const { server, invite } = await servers.createWithOwner(
        GENERAL,
        OWNER_ID,
      );

      await servers.delete(server.id);

      // Invite cascades off Server at the schema level (data-model.md section
      // 7); without it the code would outlive the server it admits people to.
      await expect(invites.findByCode(invite.code)).resolves.toBeNull();
    });

    it('createWithOwner retries past a colliding code and still commits', async () => {
      await prisma.user.create({ data: userFixture(OWNER_ID) });
      const taken = await servers.createWithOwner(GENERAL, OWNER_ID);

      // Force the collision the retry exists for: the first draw hands back a
      // code the unique index already holds, so the write must abort its
      // transaction, draw again, and commit on the second attempt.
      const spy = jest
        .spyOn(inviteCode, 'generateInviteCode')
        .mockReturnValueOnce(taken.invite.code);

      const retried = await servers.createWithOwner(GENERAL, OWNER_ID);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(retried.invite.code).not.toBe(taken.invite.code);
      // The aborted first attempt must leave nothing behind: two servers
      // exist, not three.
      await expect(prisma.server.count()).resolves.toBe(2);
      await expect(prisma.invite.count()).resolves.toBe(2);

      spy.mockRestore();
    });

    it('regenerate retries past a colliding code', async () => {
      await prisma.user.create({ data: userFixture(OWNER_ID) });
      const other = await servers.createWithOwner(GENERAL, OWNER_ID);
      const target = await servers.createWithOwner(GENERAL, OWNER_ID);

      const spy = jest
        .spyOn(inviteCode, 'generateInviteCode')
        .mockReturnValueOnce(other.invite.code);

      const regenerated = await invites.regenerate(target.server.id);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(regenerated.code).not.toBe(other.invite.code);
      expect(regenerated.code).not.toBe(target.invite.code);

      spy.mockRestore();
    });

    it('gives up after five colliding draws rather than looping forever', async () => {
      await prisma.user.create({ data: userFixture(OWNER_ID) });
      const taken = await servers.createWithOwner(GENERAL, OWNER_ID);

      const spy = jest
        .spyOn(inviteCode, 'generateInviteCode')
        .mockReturnValue(taken.invite.code);

      // A generator stuck on one code is a broken generator. The bound is what
      // surfaces that as a failed request instead of a hung one.
      await expect(
        servers.createWithOwner(GENERAL, OWNER_ID),
      ).rejects.toThrow();
      expect(spy).toHaveBeenCalledTimes(5);

      spy.mockRestore();
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
  /**
   * The listing's read count, against real Postgres.
   *
   * The claim under test is that `listChannels` does a **bounded** number of
   * reads — never one per channel, which would be N+1 on the most-hit read in
   * the app. It is asserted by counting calls into the ports, with the real
   * Prisma adapters underneath, so real SQL runs throughout. Each of the four
   * calls is one statement in these adapters, so the port count and the
   * statement count are the same number here; that is worth stating rather
   * than leaving a reader to assume it.
   *
   * `jest.spyOn` on the adapter instances rather than hand-written counting
   * wrappers: it counts the same thing with nothing new to keep in step with
   * the ports.
   */
  describe('the channel listing does a bounded number of reads', () => {
    const LISTING_SERVER_ID = 810000000000000001n;
    const LISTING_OWNER_ID = 810000000000000002n;
    const LISTING_CALLER_ID = 810000000000000003n;

    let service: AdministrationService;

    beforeEach(async () => {
      await truncateAll(prisma);
      await prisma.user.createMany({
        data: [userFixture(LISTING_OWNER_ID), userFixture(LISTING_CALLER_ID)],
      });
      await prisma.server.create({
        data: serverFixture(LISTING_SERVER_ID),
      });
      await prisma.membership.createMany({
        data: [
          {
            serverId: LISTING_SERVER_ID,
            userId: LISTING_OWNER_ID,
            role: 'owner',
          },
          {
            serverId: LISTING_SERVER_ID,
            userId: LISTING_CALLER_ID,
            role: 'member',
          },
        ],
      });

      service = new AdministrationService(
        servers,
        memberships,
        invites,
        channels,
        channelMembers,
        channelOverrides,
        new EventEmitter2(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /** `count` channels, every third one private, every fifth overridden. */
    async function seedChannels(count: number): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        const channel = await channels.create({
          serverId: LISTING_SERVER_ID,
          name: `channel-${index}`,
          isPrivate: index % 3 === 0,
        });

        if (index % 5 === 0) {
          await channelOverrides.revoke(channel.id, 'member', 'view');
        }
      }
    }

    function countReads() {
      return {
        byServer: jest.spyOn(channels, 'findByServerId'),
        membership: jest.spyOn(memberships, 'findByServerAndUser'),
        bulkMembers: jest.spyOn(channelMembers, 'findChannelIdsForUser'),
        bulkOverrides: jest.spyOn(channelOverrides, 'findByChannelIds'),
        perChannelMember: jest.spyOn(channelMembers, 'isMember'),
        perChannelOverride: jest.spyOn(channelOverrides, 'findByChannelId'),
      };
    }

    it.each([[1], [20]])(
      'reads four times over a server of %i channels',
      async (count) => {
        await seedChannels(count);
        const reads = countReads();

        await service.listChannels(LISTING_SERVER_ID, LISTING_CALLER_ID);

        expect(reads.byServer).toHaveBeenCalledTimes(1);
        expect(reads.membership).toHaveBeenCalledTimes(1);
        expect(reads.bulkMembers).toHaveBeenCalledTimes(1);
        expect(reads.bulkOverrides).toHaveBeenCalledTimes(1);
        // The per-channel reads are the N+1 the bulk methods exist to avoid.
        expect(reads.perChannelMember).not.toHaveBeenCalled();
        expect(reads.perChannelOverride).not.toHaveBeenCalled();
      },
    );

    it('still filters correctly at twenty channels', async () => {
      await seedChannels(20);

      const listed = await service.listChannels(
        LISTING_SERVER_ID,
        LISTING_CALLER_ID,
      );

      // Bounded reads are worth nothing if the answer is wrong. Of the
      // twenty, indices 0/3/6/9/12/15/18 are private with no member row, and
      // 5 and 10 are public with `view` revoked for `member` (0 and 15 are
      // overridden too, but were already hidden). The other eleven are
      // visible. Asserted by name, not by count, so a wrong answer of the
      // right size still fails.
      expect(listed.map((channel) => channel.name).sort()).toEqual(
        [
          'channel-1',
          'channel-11',
          'channel-13',
          'channel-14',
          'channel-16',
          'channel-17',
          'channel-19',
          'channel-2',
          'channel-4',
          'channel-7',
          'channel-8',
        ].sort(),
      );
    });
  });

  /**
   * `listAccessibleChannels`' read count, against real Postgres — the #64 AC
   * "a bounded number of queries regardless of how many servers and
   * channels", asserted the same way the channel listing's bound is above:
   * `jest.spyOn` on the adapter instances, real SQL throughout, each bulk
   * call one statement in these adapters.
   *
   * The shape under test is per-*user* rather than per-server: three servers
   * of channels must still be two reads before the channel-scoped pair, and
   * never one `findByServerId` per server.
   */
  describe('the accessible listing does a bounded number of reads', () => {
    const ACCESS_OWNER_ID = 810000000000000011n;
    const ACCESS_USER_ID = 810000000000000012n;

    let service: AdministrationService;

    beforeEach(async () => {
      await truncateAll(prisma);
      await prisma.user.createMany({
        data: [userFixture(ACCESS_OWNER_ID), userFixture(ACCESS_USER_ID)],
      });
      service = new AdministrationService(
        servers,
        memberships,
        invites,
        channels,
        channelMembers,
        channelOverrides,
        new EventEmitter2(),
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /**
     * `serverCount` servers, `channelsPerServer` channels each. ACCESS_OWNER
     * owns them all; ACCESS_USER is an ordinary member of every one — so the
     * member path (all four reads) and the owner path (channel-scoped pair
     * skipped) are both reachable.
     */
    async function seedWorld(
      serverCount: number,
      channelsPerServer: number,
    ): Promise<void> {
      for (let index = 0; index < serverCount; index += 1) {
        const serverId = 810000000000000100n + BigInt(index);
        await prisma.server.create({ data: serverFixture(serverId) });
        await prisma.membership.createMany({
          data: [
            { serverId, userId: ACCESS_OWNER_ID, role: 'owner' },
            { serverId, userId: ACCESS_USER_ID, role: 'member' },
          ],
        });
        for (let channel = 0; channel < channelsPerServer; channel += 1) {
          await channels.create({
            serverId,
            name: `channel-${channel}`,
            isPrivate: channel % 3 === 0,
          });
        }
      }
    }

    function countReads() {
      return {
        membershipsForUser: jest.spyOn(memberships, 'findByUserId'),
        byServerIds: jest.spyOn(channels, 'findByServerIds'),
        byServerId: jest.spyOn(channels, 'findByServerId'),
        bulkMembers: jest.spyOn(channelMembers, 'findChannelIdsForUser'),
        bulkOverrides: jest.spyOn(channelOverrides, 'findByChannelIds'),
        perChannelMember: jest.spyOn(channelMembers, 'isMember'),
        perChannelOverride: jest.spyOn(channelOverrides, 'findByChannelId'),
      };
    }

    it.each([
      [1, 5],
      [20, 5],
    ])(
      'reads four times over %i servers of %i channels',
      async (serverCount, channelsPerServer) => {
        await seedWorld(serverCount, channelsPerServer);
        const reads = countReads();

        await service.listAccessibleChannels(ACCESS_USER_ID);

        expect(reads.membershipsForUser).toHaveBeenCalledTimes(1);
        expect(reads.byServerIds).toHaveBeenCalledTimes(1);
        // One query per server is the N+1 this method exists to avoid.
        expect(reads.byServerId).not.toHaveBeenCalled();
        expect(reads.bulkMembers).toHaveBeenCalledTimes(1);
        expect(reads.bulkOverrides).toHaveBeenCalledTimes(1);
        expect(reads.perChannelMember).not.toHaveBeenCalled();
        expect(reads.perChannelOverride).not.toHaveBeenCalled();
      },
    );

    it('makes no channel-scoped read when the caller owns every server', async () => {
      await seedWorld(3, 5);
      const reads = countReads();

      await service.listAccessibleChannels(ACCESS_OWNER_ID);

      expect(reads.membershipsForUser).toHaveBeenCalledTimes(1);
      expect(reads.byServerIds).toHaveBeenCalledTimes(1);
      expect(reads.bulkMembers).not.toHaveBeenCalled();
      expect(reads.bulkOverrides).not.toHaveBeenCalled();
    });

    it('still filters correctly across three servers', async () => {
      await seedWorld(3, 7);
      // Revoke `view` on public channel-1 of the first server; the private
      // channels (indices 0/3/6 of every server) are already hidden, since
      // the caller holds no ChannelMember rows.
      const first = 810000000000000100n;
      const gated = await prisma.channel.findFirstOrThrow({
        where: { serverId: first, name: 'channel-1' },
      });
      await channelOverrides.revoke(gated.id, 'member', 'view');

      const listed = await service.listAccessibleChannels(ACCESS_USER_ID);

      // 21 channels seeded; per server the three private ones are hidden,
      // and the first server also loses channel-1 — eleven visible. Asserted
      // by name in the first server so a wrong answer of the right size fails.
      expect(listed).toHaveLength(11);
      expect(listed.map((channel) => channel.name)).not.toContain('channel-0');
      expect(
        listed
          .filter((channel) => channel.serverId === first)
          .map((channel) => channel.name)
          .sort(),
      ).toEqual(['channel-2', 'channel-4', 'channel-5'].sort());
    });
  });
});
