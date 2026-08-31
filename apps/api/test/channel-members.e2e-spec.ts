import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990080,
  login: 'octocat-members-e2e-owner',
  email: 'octocat-members-e2e-owner@example.com',
};

const MODERATOR = {
  githubId: 990081,
  login: 'octocat-members-e2e-moderator',
  email: 'octocat-members-e2e-moderator@example.com',
};

const MEMBER = {
  githubId: 990082,
  login: 'octocat-members-e2e-member',
  email: 'octocat-members-e2e-member@example.com',
};

const OUTSIDER = {
  githubId: 990083,
  login: 'octocat-members-e2e-outsider',
  email: 'octocat-members-e2e-outsider@example.com',
};

const FIXTURES = [OWNER, MODERATOR, MEMBER, OUTSIDER];

function stubGithubExchange(fixture: (typeof FIXTURES)[number]): void {
  nock('https://github.com')
    .post('/login/oauth/access_token')
    .reply(200, { access_token: 'test-access-token', token_type: 'bearer' });

  nock('https://api.github.com').get('/user').reply(200, {
    id: fixture.githubId,
    login: fixture.login,
    name: 'The Octocat',
    avatar_url: 'https://avatars.example.com/4',
  });

  nock('https://api.github.com')
    .get('/user/emails')
    .reply(200, [{ email: fixture.email, primary: true, verified: true }]);
}

function idOf(body: unknown): string {
  return (body as { id: string }).id;
}

/** The `error` object off a non-2xx body — see `common/errors.ts`'s own doc. */
function errorOf(body: unknown): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  return (
    body as {
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    }
  ).error;
}

function userIdsOf(body: unknown): string[] {
  return (body as { userId: string }[]).map((member) => member.userId);
}

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

async function loggedInAgent(
  app: INestApplication<App>,
  fixture: (typeof FIXTURES)[number],
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app.getHttpServer());
  const initial = await agent.get('/auth/github');
  stubGithubExchange(fixture);
  await agent.get(
    `/auth/github/callback?code=test-code&state=${extractState(initial.headers.location)}`,
  );
  return agent;
}

describe('Channel settings and membership (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    nock.enableNetConnect();
  });

  afterEach(async () => {
    const githubIds = FIXTURES.map((fixture) => String(fixture.githubId));

    // Servers first, then users: Membership.server is Cascade but
    // Membership.user is Restrict (data-model.md section 7).
    await prisma.server.deleteMany({
      where: {
        memberships: { some: { user: { githubId: { in: githubIds } } } },
      },
    });
    await prisma.user.deleteMany({ where: { githubId: { in: githubIds } } });

    const keys = await redis.keys('huddle:rl:*');
    if (keys.length > 0) await redis.del(...keys);

    nock.cleanAll();
  });

  /** See `channels.e2e-spec.ts` for why the two budgets are reset by hand. */
  async function resetLoginBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:auth-ip:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function resetMutationBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:strict-mutation:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function userIdOf(fixture: (typeof FIXTURES)[number]): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { githubId: String(fixture.githubId) },
    });
    if (user === null) throw new Error(`No user for ${fixture.login}`);
    return user.id.toString();
  }

  interface Seeded {
    serverId: string;
    /** A public channel. */
    channelId: string;
    /** A second public channel, for proving an override is channel-scoped. */
    siblingId: string;
    /** A private channel, with nobody seated in it. */
    privateId: string;
    owner: ReturnType<typeof request.agent>;
    moderator: ReturnType<typeof request.agent>;
    member: ReturnType<typeof request.agent>;
    outsider: ReturnType<typeof request.agent>;
  }

  /**
   * A server with all four fixtures logged in, the moderator and member
   * seated, the outsider left out of it, and three channels.
   *
   * The two channels the manage_settings tests use are **public** on
   * purpose. A private channel is hidden from a moderator who holds no
   * `ChannelMember` row in it — every route on it answers 404, not 403 —
   * so a private fixture would test hiding rather than the capability. The
   * private one is here for the member routes, which only exist for private
   * channels.
   */
  async function seed(): Promise<Seeded> {
    const owner = await loggedInAgent(app, OWNER);
    await resetLoginBudget();
    const moderator = await loggedInAgent(app, MODERATOR);
    await resetLoginBudget();
    const member = await loggedInAgent(app, MEMBER);
    await resetLoginBudget();
    const outsider = await loggedInAgent(app, OUTSIDER);

    const created = await owner.post('/servers').send({ name: 'Members Test' });
    const serverId = idOf(created.body);

    for (const [fixture, role] of [
      [MODERATOR, 'moderator'],
      [MEMBER, 'member'],
    ] as const) {
      await prisma.membership.create({
        data: {
          serverId: BigInt(serverId),
          userId: BigInt(await userIdOf(fixture)),
          role,
        },
      });
    }

    await resetMutationBudget();

    const channel = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'general', isPrivate: false });
    const sibling = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'random', isPrivate: false });
    await resetMutationBudget();
    const secret = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'mods', isPrivate: true });

    await resetMutationBudget();

    return {
      serverId,
      channelId: idOf(channel.body),
      siblingId: idOf(sibling.body),
      privateId: idOf(secret.body),
      owner,
      moderator,
      member,
      outsider,
    };
  }

  describe('PATCH /channels/:channelId', () => {
    it('lets a moderator rename a channel', async () => {
      const { channelId, moderator } = await seed();

      const response = await moderator
        .patch(`/channels/${channelId}`)
        .send({ name: 'renamed' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: channelId, name: 'renamed' });
    });

    it('refuses a member — they never hold manage_settings', async () => {
      const { channelId, member } = await seed();
      // A public channel, so the member can plainly see it: the refusal is
      // about the capability, not about the channel being hidden from them.

      const response = await member
        .patch(`/channels/${channelId}`)
        .send({ name: 'renamed' });

      expect(response.status).toBe(403);
      expect(errorOf(response.body).code).toBe('FORBIDDEN');
    });

    it('rejects a rename onto a name the server already uses with 409', async () => {
      // `channelId` is already called 'general'; renaming its sibling onto
      // that name is what UNIQUE (serverId, name) refuses.
      const { siblingId, owner } = await seed();

      const response = await owner
        .patch(`/channels/${siblingId}`)
        .send({ name: 'general' });

      expect(response.status).toBe(409);
      expect(errorOf(response.body).code).toBe('CONFLICT');
    });

    it("allows a rename onto the channel's own current name", async () => {
      const { channelId, owner } = await seed();

      const response = await owner
        .patch(`/channels/${channelId}`)
        .send({ name: 'general' });

      // A no-op update is not a collision with itself.
      expect(response.status).toBe(200);
    });

    it('keeps the member list across a private, public, private round trip', async () => {
      const { privateId, owner } = await seed();
      const memberId = await userIdOf(MEMBER);
      await owner.post(`/channels/${privateId}/members`).send({
        userId: memberId,
      });
      await resetMutationBudget();

      await owner.patch(`/channels/${privateId}`).send({ isPrivate: false });
      await owner.patch(`/channels/${privateId}`).send({ isPrivate: true });
      await resetMutationBudget();

      // Inert while public, meaningful again after the flip back. Asserted
      // against the database rather than the route, so this is about the row
      // surviving rather than about what the route chose to show.
      await expect(
        prisma.channelMember.findMany({
          where: { channelId: BigInt(privateId) },
        }),
      ).resolves.toHaveLength(1);

      const listed = await owner.get(`/channels/${privateId}/members`);
      expect(userIdsOf(listed.body)).toEqual([memberId]);
    });
  });

  describe('DELETE /channels/:channelId', () => {
    it('lets a moderator delete a channel', async () => {
      const { channelId, moderator } = await seed();

      const response = await moderator.delete(`/channels/${channelId}`);

      expect(response.status).toBe(204);
      await expect(
        prisma.channel.findUnique({ where: { id: BigInt(channelId) } }),
      ).resolves.toBeNull();
    });

    it('refuses a member', async () => {
      const { channelId, member } = await seed();

      const response = await member.delete(`/channels/${channelId}`);

      expect(response.status).toBe(403);
      await expect(
        prisma.channel.findUnique({ where: { id: BigInt(channelId) } }),
      ).resolves.not.toBeNull();
    });
  });

  describe('the member routes', () => {
    it('seats a server member and lists them', async () => {
      const { privateId, owner } = await seed();
      const memberId = await userIdOf(MEMBER);

      const added = await owner
        .post(`/channels/${privateId}/members`)
        .send({ userId: memberId });

      // 200, not 201: the route is idempotent and creates nothing on a
      // repeat, so it never claims to have made a resource.
      expect(added.status).toBe(200);
      expect(added.body).toMatchObject({
        channelId: privateId,
        userId: memberId,
      });

      const listed = await owner.get(`/channels/${privateId}/members`);
      expect(listed.status).toBe(200);
      expect(userIdsOf(listed.body)).toEqual([memberId]);
    });

    it('re-adding is idempotent and keeps the original addedAt', async () => {
      const { privateId, owner } = await seed();
      const memberId = await userIdOf(MEMBER);
      const first = await owner
        .post(`/channels/${privateId}/members`)
        .send({ userId: memberId });

      const second = await owner
        .post(`/channels/${privateId}/members`)
        .send({ userId: memberId });

      expect(second.status).toBe(200);
      expect((second.body as { addedAt: string }).addedAt).toBe(
        (first.body as { addedAt: string }).addedAt,
      );
      await expect(
        prisma.channelMember.findMany({
          where: { channelId: BigInt(privateId) },
        }),
      ).resolves.toHaveLength(1);
    });

    it('removing someone who is not there is a 204', async () => {
      const { privateId, owner } = await seed();

      const response = await owner.delete(
        `/channels/${privateId}/members/${await userIdOf(MEMBER)}`,
      );

      expect(response.status).toBe(204);
    });

    it('removes a seated member', async () => {
      const { privateId, owner } = await seed();
      const memberId = await userIdOf(MEMBER);
      await owner
        .post(`/channels/${privateId}/members`)
        .send({ userId: memberId });

      const response = await owner.delete(
        `/channels/${privateId}/members/${memberId}`,
      );

      expect(response.status).toBe(204);
      const listed = await owner.get(`/channels/${privateId}/members`);
      expect(userIdsOf(listed.body)).toEqual([]);
    });

    it('rejects a user who is not in the server with 400', async () => {
      const { privateId, owner } = await seed();

      const response = await owner
        .post(`/channels/${privateId}/members`)
        .send({ userId: await userIdOf(OUTSIDER) });

      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('VALIDATION_FAILED');
      // Channel membership narrows server membership; it is never a way in.
      await expect(
        prisma.channelMember.findMany({
          where: { channelId: BigInt(privateId) },
        }),
      ).resolves.toEqual([]);
    });

    it('rejects an add to a public channel with 400', async () => {
      const { channelId, owner } = await seed();

      const response = await owner
        .post(`/channels/${channelId}/members`)
        .send({ userId: await userIdOf(MEMBER) });

      expect(response.status).toBe(400);
      expect(errorOf(response.body).code).toBe('VALIDATION_FAILED');
    });

    it('lists an empty member list for a public channel rather than 400', async () => {
      const { channelId, owner } = await seed();

      const response = await owner.get(`/channels/${channelId}/members`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('refuses a member on all three member routes', async () => {
      const { privateId, owner, member } = await seed();
      const memberId = await userIdOf(MEMBER);
      // Seated, so a 403 here is the capability refusing rather than the
      // channel being hidden — an unseated member would get 404 instead.
      await owner
        .post(`/channels/${privateId}/members`)
        .send({ userId: memberId });
      await resetMutationBudget();

      const statuses = [
        (await member.get(`/channels/${privateId}/members`)).status,
        (
          await member
            .post(`/channels/${privateId}/members`)
            .send({ userId: memberId })
        ).status,
        (await member.delete(`/channels/${privateId}/members/${memberId}`))
          .status,
      ];

      // A Member never holds manage_settings anywhere in the server, so the
      // server refuses however the client is tampered with.
      expect(statuses).toEqual([403, 403, 403]);
    });
  });

  describe('an override on one channel', () => {
    /**
     * Written straight to the table rather than through the override routes,
     * which land with #53. This spec is about #52's routes reacting to an
     * override, not about how the row got there.
     */
    async function revokeModeratorManageSettings(
      channelId: string,
    ): Promise<void> {
      await prisma.channelOverride.create({
        data: {
          channelId: BigInt(channelId),
          role: 'moderator',
          capability: 'manage_settings',
        },
      });
    }

    it('takes manage_settings from a moderator there and nowhere else', async () => {
      const { channelId, siblingId, moderator } = await seed();

      // Before: the same moderator, the same route, and it works.
      const before = await moderator
        .patch(`/channels/${channelId}`)
        .send({ name: 'before' });
      expect(before.status).toBe(200);

      await revokeModeratorManageSettings(channelId);
      await resetMutationBudget();

      const after = await moderator
        .patch(`/channels/${channelId}`)
        .send({ name: 'after' });
      const elsewhere = await moderator
        .patch(`/channels/${siblingId}`)
        .send({ name: 'elsewhere' });

      // Tightened in one channel only. Asserting both directions is the
      // point: a blanket-deny bug would pass the first expectation alone.
      expect(after.status).toBe(403);
      expect(elsewhere.status).toBe(200);
    });

    it('does not touch the owner', async () => {
      const { channelId, owner } = await seed();
      await revokeModeratorManageSettings(channelId);

      const response = await owner
        .patch(`/channels/${channelId}`)
        .send({ name: 'owner-still-can' });

      // Authority is a server-level fact a channel can never touch, and the
      // owner is the way back from a moderator locking themselves out.
      expect(response.status).toBe(200);
    });
  });
});
