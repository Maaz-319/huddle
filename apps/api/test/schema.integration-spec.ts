import {
  Capability,
  ChannelCreationPolicy,
  OverrideRole,
  PrismaClient,
  Role,
} from '../src/generated/prisma/client';
import { createTestClient, truncateAll } from './prisma-test-client';

/**
 * The schema's constraints, asserted against a real Postgres.
 *
 * Every case here checks that a bad write is REJECTED. A spec that only
 * inserted valid rows would pass just as happily against a schema with the
 * constraint dropped, which is the failure mode AGENTS.md section 5 is about.
 *
 * The accepted-write cases are not padding: they are what distinguishes the
 * partial unique index from a plain UNIQUE (serverId), and a per-server channel
 * name from a global one. Without them the whole file passes against a wrong
 * schema.
 */
describe('database schema constraints', () => {
  let prisma: PrismaClient;

  // Snowflake-shaped, i.e. too large for a JS number. The point is that these
  // round-trip through BigInt columns without losing precision.
  const ALICE = 300000000000000001n;
  const BOB = 300000000000000002n;
  const SERVER = 400000000000000001n;
  const OTHER_SERVER = 400000000000000002n;
  const CHANNEL = 500000000000000001n;

  beforeAll(() => {
    prisma = createTestClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const createUser = (id: bigint, username: string) =>
    prisma.user.create({
      data: {
        id,
        githubId: `gh-${username}`,
        username,
        avatarUrl: `https://example.test/${username}.png`,
        email: `${username}@example.test`,
      },
    });

  const createServer = (id: bigint, name: string) =>
    prisma.server.create({
      data: {
        id,
        name,
        channelCreationPolicy: ChannelCreationPolicy.owner_only,
        memberInviteToggle: false,
      },
    });

  const createChannel = (id: bigint, serverId: bigint, name: string) =>
    prisma.channel.create({
      data: { id, serverId, name, isPrivate: false },
    });

  describe('one owner per server', () => {
    beforeEach(async () => {
      await createUser(ALICE, 'alice');
      await createUser(BOB, 'bob');
      await createServer(SERVER, 'Huddle HQ');
    });

    it('rejects a second owner in the same server', async () => {
      await prisma.membership.create({
        data: { serverId: SERVER, userId: ALICE, role: Role.owner },
      });

      await expect(
        prisma.membership.create({
          data: { serverId: SERVER, userId: BOB, role: Role.owner },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('allows the same user to own a different server', async () => {
      await createServer(OTHER_SERVER, 'Side Project');

      await prisma.membership.create({
        data: { serverId: SERVER, userId: ALICE, role: Role.owner },
      });
      await prisma.membership.create({
        data: { serverId: OTHER_SERVER, userId: ALICE, role: Role.owner },
      });

      await expect(
        prisma.membership.count({ where: { role: Role.owner } }),
      ).resolves.toBe(2);
    });

    it('allows many non-owners in one server', async () => {
      await prisma.membership.create({
        data: { serverId: SERVER, userId: ALICE, role: Role.member },
      });
      await prisma.membership.create({
        data: { serverId: SERVER, userId: BOB, role: Role.member },
      });

      await expect(
        prisma.membership.count({ where: { serverId: SERVER } }),
      ).resolves.toBe(2);
    });
  });

  describe('cascade deletes', () => {
    beforeEach(async () => {
      await createUser(ALICE, 'alice');
      await createServer(SERVER, 'Huddle HQ');
      await createChannel(CHANNEL, SERVER, 'general');
    });

    it("removes a server's channels, memberships and invite", async () => {
      await prisma.membership.create({
        data: { serverId: SERVER, userId: ALICE, role: Role.owner },
      });
      await prisma.invite.create({
        data: { id: 600000000000000001n, serverId: SERVER, code: 'abc123' },
      });

      await prisma.server.delete({ where: { id: SERVER } });

      await expect(prisma.channel.count()).resolves.toBe(0);
      await expect(prisma.membership.count()).resolves.toBe(0);
      await expect(prisma.invite.count()).resolves.toBe(0);
    });

    it("removes a channel's messages, members and overrides", async () => {
      await prisma.message.create({
        data: {
          id: 700000000000000001n,
          channelId: CHANNEL,
          authorId: ALICE,
          content: 'hello',
        },
      });
      await prisma.channelMember.create({
        data: { channelId: CHANNEL, userId: ALICE },
      });
      await prisma.channelOverride.create({
        data: {
          channelId: CHANNEL,
          role: OverrideRole.member,
          capability: Capability.post,
        },
      });

      await prisma.channel.delete({ where: { id: CHANNEL } });

      await expect(prisma.message.count()).resolves.toBe(0);
      await expect(prisma.channelMember.count()).resolves.toBe(0);
      await expect(prisma.channelOverride.count()).resolves.toBe(0);
    });

    it('keeps a user who has authored messages', async () => {
      await prisma.message.create({
        data: {
          id: 700000000000000002n,
          channelId: CHANNEL,
          authorId: ALICE,
          content: 'hello',
        },
      });

      // Restrict, not Cascade: no feature deletes a user, and a cascade here
      // would silently erase their message history the day one is added.
      await expect(
        prisma.user.delete({ where: { id: ALICE } }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });

  describe('one invite per server', () => {
    it('rejects a second invite row for the same server', async () => {
      await createServer(SERVER, 'Huddle HQ');
      await prisma.invite.create({
        data: { id: 600000000000000001n, serverId: SERVER, code: 'abc123' },
      });

      await expect(
        prisma.invite.create({
          data: { id: 600000000000000002n, serverId: SERVER, code: 'def456' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('channel names are unique per server, not globally', () => {
    beforeEach(async () => {
      await createServer(SERVER, 'Huddle HQ');
      await createServer(OTHER_SERVER, 'Side Project');
    });

    it('rejects a duplicate name within one server', async () => {
      await createChannel(CHANNEL, SERVER, 'general');

      await expect(
        createChannel(500000000000000002n, SERVER, 'general'),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('allows the same name in a different server', async () => {
      await createChannel(CHANNEL, SERVER, 'general');
      await createChannel(500000000000000003n, OTHER_SERVER, 'general');

      await expect(
        prisma.channel.count({ where: { name: 'general' } }),
      ).resolves.toBe(2);
    });
  });

  describe('channel overrides', () => {
    beforeEach(async () => {
      await createServer(SERVER, 'Huddle HQ');
      await createChannel(CHANNEL, SERVER, 'general');
    });

    it('rejects a duplicate role and capability pair', async () => {
      await prisma.channelOverride.create({
        data: {
          channelId: CHANNEL,
          role: OverrideRole.member,
          capability: Capability.post,
        },
      });

      await expect(
        prisma.channelOverride.create({
          data: {
            channelId: CHANNEL,
            role: OverrideRole.member,
            capability: Capability.post,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('allows the same capability for a different role', async () => {
      await prisma.channelOverride.create({
        data: {
          channelId: CHANNEL,
          role: OverrideRole.member,
          capability: Capability.post,
        },
      });
      await prisma.channelOverride.create({
        data: {
          channelId: CHANNEL,
          role: OverrideRole.moderator,
          capability: Capability.post,
        },
      });

      await expect(prisma.channelOverride.count()).resolves.toBe(2);
    });
  });

  it('stores snowflake ids without losing precision', async () => {
    await createUser(ALICE, 'alice');

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: ALICE },
    });

    expect(stored.id).toBe(ALICE);
    // And the value genuinely needs a BigInt column: routing it through a JS
    // number would have quietly changed it.
    expect(BigInt(Number(stored.id))).not.toBe(ALICE);
  });
});
