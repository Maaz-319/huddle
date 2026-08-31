import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990060,
  login: 'octocat-channels-e2e-owner',
  email: 'octocat-channels-e2e-owner@example.com',
};

const MODERATOR = {
  githubId: 990061,
  login: 'octocat-channels-e2e-moderator',
  email: 'octocat-channels-e2e-moderator@example.com',
};

const MEMBER = {
  githubId: 990062,
  login: 'octocat-channels-e2e-member',
  email: 'octocat-channels-e2e-member@example.com',
};

const OUTSIDER = {
  githubId: 990063,
  login: 'octocat-channels-e2e-outsider',
  email: 'octocat-channels-e2e-outsider@example.com',
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

/** The `id` field off a `POST /servers` or `POST .../channels` response body. */
function idOf(body: unknown): string {
  return (body as { id: string }).id;
}

/** The `error.code` off a non-2xx body — see `common/errors.ts`'s own doc. */
function errorCodeOf(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

/** The `name` fields off a channel-list response body. */
function namesOf(body: unknown): string[] {
  return (body as { name: string }[]).map((channel) => channel.name);
}

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

/** Logs in a fresh agent via the #31 OAuth flow, returning it with a live session cookie. */
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

describe('POST/GET /servers/:serverId/channels (e2e)', () => {
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

  /**
   * Clears the per-IP login budget.
   *
   * `auth-ip` allows 5 tokens and a login spends 2, so a test needing three
   * real sessions would be throttled on the third. Supertest has no real
   * network hop to vary the caller address with, so the budget is reset
   * between logins rather than worked around by faking a user row.
   */
  async function resetLoginBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:auth-ip:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  /**
   * Clears the per-user strict-mutation budget.
   *
   * `strict-mutation` is 3 tokens a minute per user and is shared across
   * every mutating route, so creating a server, patching its policy and then
   * creating a channel exhausts one caller's budget on its own. This is test
   * scaffolding to keep the assertions about the guards rather than about
   * the limiter — it is not a claim that the budget is wrong.
   */
  async function resetMutationBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:strict-mutation:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  /** The owner's server, with the moderator and member seated in it. */
  async function seedServer(): Promise<{
    serverId: string;
    owner: ReturnType<typeof request.agent>;
    moderator: ReturnType<typeof request.agent>;
    member: ReturnType<typeof request.agent>;
  }> {
    const owner = await loggedInAgent(app, OWNER);
    await resetLoginBudget();
    const moderator = await loggedInAgent(app, MODERATOR);
    await resetLoginBudget();
    const member = await loggedInAgent(app, MEMBER);

    const created = await owner.post('/servers').send({ name: 'Channel Test' });
    const serverId = idOf(created.body);

    for (const [fixture, role] of [
      [MODERATOR, 'moderator'],
      [MEMBER, 'member'],
    ] as const) {
      const user = await prisma.user.findUnique({
        where: { githubId: String(fixture.githubId) },
      });
      if (user === null) throw new Error(`No user for ${fixture.login}`);
      await prisma.membership.create({
        data: { serverId: BigInt(serverId), userId: user.id, role },
      });
    }

    await resetMutationBudget();

    return { serverId, owner, moderator, member };
  }

  describe('POST', () => {
    it('creates a channel for the owner', async () => {
      const { serverId, owner } = await seedServer();

      const response = await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        serverId,
        name: 'general',
        isPrivate: false,
      });
      // Snowflakes leave as strings in both directions (AGENTS.md section 4).
      expect(typeof idOf(response.body)).toBe('string');
    });

    it('rejects a duplicate name in the same server with 409', async () => {
      const { serverId, owner } = await seedServer();
      await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false });

      const response = await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: true });

      expect(response.status).toBe(409);
      expect(errorCodeOf(response.body)).toBe('CONFLICT');
    });

    it('allows the same name in a different server', async () => {
      const { serverId, owner } = await seedServer();
      await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false });
      await resetMutationBudget();
      const second = await owner.post('/servers').send({ name: 'Second' });
      await resetMutationBudget();

      const response = await owner
        .post(`/servers/${idOf(second.body)}/channels`)
        .send({ name: 'general', isPrivate: false });

      // UNIQUE (serverId, name) is scoped to the server, not global. Asserted
      // alongside the 409 above so the constraint's *shape* is pinned, not
      // just that some duplicate is rejected somewhere.
      expect(response.status).toBe(201);
    });

    it('creates a private channel without seating anybody in it', async () => {
      const { serverId, owner } = await seedServer();

      const response = await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'mods', isPrivate: true });

      expect(response.status).toBe(201);
      await expect(
        prisma.channelMember.count({
          where: { channelId: BigInt(idOf(response.body)) },
        }),
      ).resolves.toBe(0);
    });

    it('rejects a body with an unknown field', async () => {
      const { serverId, owner } = await seedServer();

      const response = await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false, serverId: '1' });

      expect(response.status).toBe(400);
    });

    it('404s for a server that does not exist', async () => {
      const { owner } = await seedServer();

      const response = await owner
        .post('/servers/999000000000000009/channels')
        .send({ name: 'general', isPrivate: false });

      expect(response.status).toBe(404);
    });

    it('403s for someone who is not in the server', async () => {
      const { serverId } = await seedServer();
      await resetLoginBudget();
      const outsider = await loggedInAgent(app, OUTSIDER);

      const response = await outsider
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false });

      expect(response.status).toBe(403);
    });

    it('refuses a member making it private, though the policy lets them create', async () => {
      const { serverId, member } = await seedServer();

      const response = await member
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'secret', isPrivate: true });

      // The default policy is `everyone`, so the creation guard says yes.
      // PRD section 5's "make a channel private" is the separate question,
      // and the answer is Owner and Moderator only.
      expect(response.status).toBe(403);
      expect(errorCodeOf(response.body)).toBe('FORBIDDEN');
    });

    it('lets that same member create a public channel', async () => {
      const { serverId, member } = await seedServer();

      const response = await member
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false });

      expect(response.status).toBe(201);
    });

    it('lets a moderator create a private channel', async () => {
      const { serverId, moderator } = await seedServer();

      const response = await moderator
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'mods', isPrivate: true });

      expect(response.status).toBe(201);
    });

    it('follows the policy live: owner_only blocks a moderator, then everyone lets a member in', async () => {
      const { serverId, owner, moderator, member } = await seedServer();
      await owner
        .patch(`/servers/${serverId}`)
        .send({ channelCreationPolicy: 'owner_only' });
      await resetMutationBudget();

      const blocked = await moderator
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'mod-channel', isPrivate: false });

      expect(blocked.status).toBe(403);

      await owner
        .patch(`/servers/${serverId}`)
        .send({ channelCreationPolicy: 'everyone' });
      await resetMutationBudget();

      const allowed = await member
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'mod-channel', isPrivate: false });

      // The identical call, from a *weaker* role, now succeeds -- which is
      // what proves the policy is read off the row on every request rather
      // than captured at boot or baked into the decorator.
      expect(allowed.status).toBe(201);
    });

    it('keeps the owner in under mods_only', async () => {
      const { serverId, owner } = await seedServer();
      await owner
        .patch(`/servers/${serverId}`)
        .send({ channelCreationPolicy: 'mods_only' });
      await resetMutationBudget();

      const response = await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false });

      expect(response.status).toBe(201);
    });
  });

  describe('GET', () => {
    it('lists the server’s channels for a member', async () => {
      const { serverId, owner, member } = await seedServer();
      await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false });
      await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'random', isPrivate: false });

      const response = await member.get(`/servers/${serverId}/channels`);

      expect(response.status).toBe(200);
      expect(namesOf(response.body).sort()).toEqual(['general', 'random']);
    });

    it('hides a private channel from a member who is not in it', async () => {
      const { serverId, owner, member } = await seedServer();
      await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'general', isPrivate: false });
      await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'mods', isPrivate: true });

      const response = await member.get(`/servers/${serverId}/channels`);

      // Fully hidden, not merely unreadable: administration-service.md
      // section 3 and PRD section 5 both say a private channel must not
      // appear in a non-member's list at all.
      expect(namesOf(response.body)).toEqual(['general']);
    });

    it('shows a private channel to a member who has been seated in it', async () => {
      const { serverId, owner, member } = await seedServer();
      const created = await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'mods', isPrivate: true });
      const user = await prisma.user.findUnique({
        where: { githubId: String(MEMBER.githubId) },
      });
      if (user === null) throw new Error('No member user');
      await prisma.channelMember.create({
        data: { channelId: BigInt(idOf(created.body)), userId: user.id },
      });

      const response = await member.get(`/servers/${serverId}/channels`);

      expect(namesOf(response.body)).toEqual(['mods']);
    });

    it('shows the owner every private channel without a ChannelMember row', async () => {
      const { serverId, owner } = await seedServer();
      await owner
        .post(`/servers/${serverId}/channels`)
        .send({ name: 'mods', isPrivate: true });

      const response = await owner.get(`/servers/${serverId}/channels`);

      // A channel cannot hide itself from its own server's owner -- authority
      // is a server-level fact a channel can never touch (PRD section 5).
      expect(namesOf(response.body)).toEqual(['mods']);
      await expect(prisma.channelMember.count()).resolves.toBe(0);
    });

    it('403s for someone who is not in the server', async () => {
      const { serverId } = await seedServer();
      await resetLoginBudget();
      const outsider = await loggedInAgent(app, OUTSIDER);

      const response = await outsider.get(`/servers/${serverId}/channels`);

      expect(response.status).toBe(403);
    });

    it('401s without a session', async () => {
      const { serverId } = await seedServer();

      const response = await request(app.getHttpServer()).get(
        `/servers/${serverId}/channels`,
      );

      expect(response.status).toBe(401);
    });
  });
});
