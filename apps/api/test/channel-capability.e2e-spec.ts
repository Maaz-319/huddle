import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990070,
  login: 'octocat-capability-e2e-owner',
  email: 'octocat-capability-e2e-owner@example.com',
};

const MODERATOR = {
  githubId: 990071,
  login: 'octocat-capability-e2e-moderator',
  email: 'octocat-capability-e2e-moderator@example.com',
};

const MEMBER = {
  githubId: 990072,
  login: 'octocat-capability-e2e-member',
  email: 'octocat-capability-e2e-member@example.com',
};

const OUTSIDER = {
  githubId: 990073,
  login: 'octocat-capability-e2e-outsider',
  email: 'octocat-capability-e2e-outsider@example.com',
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

describe('GET /channels/:channelId (e2e)', () => {
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

  /** See channels.e2e-spec.ts for why these two resets exist. */
  async function resetLoginBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:auth-ip:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function resetMutationBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:strict-mutation:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function userIdOf(fixture: (typeof FIXTURES)[number]): Promise<bigint> {
    const user = await prisma.user.findUnique({
      where: { githubId: String(fixture.githubId) },
    });
    if (user === null) throw new Error(`No user for ${fixture.login}`);
    return user.id;
  }

  /** A server with a public and a private channel, and all three roles seated. */
  async function seed(): Promise<{
    publicId: string;
    privateId: string;
    owner: ReturnType<typeof request.agent>;
    moderator: ReturnType<typeof request.agent>;
    member: ReturnType<typeof request.agent>;
  }> {
    const owner = await loggedInAgent(app, OWNER);
    await resetLoginBudget();
    const moderator = await loggedInAgent(app, MODERATOR);
    await resetLoginBudget();
    const member = await loggedInAgent(app, MEMBER);

    const created = await owner.post('/servers').send({ name: 'Capability' });
    const serverId = idOf(created.body);

    for (const [fixture, role] of [
      [MODERATOR, 'moderator'],
      [MEMBER, 'member'],
    ] as const) {
      await prisma.membership.create({
        data: {
          serverId: BigInt(serverId),
          userId: await userIdOf(fixture),
          role,
        },
      });
    }

    await resetMutationBudget();
    const pub = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'general', isPrivate: false });
    const priv = await owner
      .post(`/servers/${serverId}/channels`)
      .send({ name: 'mods', isPrivate: true });
    await resetMutationBudget();

    return {
      publicId: idOf(pub.body),
      privateId: idOf(priv.body),
      owner,
      moderator,
      member,
    };
  }

  it('returns a public channel to an ordinary member', async () => {
    const { publicId, member } = await seed();

    const response = await member.get(`/channels/${publicId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: publicId,
      name: 'general',
      isPrivate: false,
    });
  });

  it('returns a private channel to the owner, who holds no ChannelMember row', async () => {
    const { privateId, owner } = await seed();

    const response = await owner.get(`/channels/${privateId}`);

    expect(response.status).toBe(200);
    await expect(prisma.channelMember.count()).resolves.toBe(0);
  });

  it('404s a private channel for a server member who is not in it', async () => {
    const { privateId, member } = await seed();

    const response = await member.get(`/channels/${privateId}`);

    // 404, not 403: a private channel is fully hidden, and a 403 would
    // confirm it exists.
    expect(response.status).toBe(404);
  });

  it('404s a private channel for a moderator who is not in it', async () => {
    const { privateId, moderator } = await seed();

    // A moderator is not the owner; the owner bypass is the owner's alone.
    const response = await moderator.get(`/channels/${privateId}`);

    expect(response.status).toBe(404);
  });

  it('returns a private channel once the caller is seated in it', async () => {
    const { privateId, member } = await seed();
    await prisma.channelMember.create({
      data: {
        channelId: BigInt(privateId),
        userId: await userIdOf(MEMBER),
      },
    });

    const response = await member.get(`/channels/${privateId}`);

    expect(response.status).toBe(200);
  });

  it('404s, not 403s, when a view override revokes the caller’s view', async () => {
    const { publicId, member } = await seed();
    await prisma.channelOverride.create({
      data: {
        channelId: BigInt(publicId),
        role: 'member',
        capability: 'view',
      },
    });

    const response = await member.get(`/channels/${publicId}`);

    expect(response.status).toBe(404);
  });

  it('leaves a moderator’s view intact when the override names only members', async () => {
    const { publicId, moderator } = await seed();
    await prisma.channelOverride.create({
      data: {
        channelId: BigInt(publicId),
        role: 'member',
        capability: 'view',
      },
    });

    // One role's revocation must not spill onto another's.
    const response = await moderator.get(`/channels/${publicId}`);

    expect(response.status).toBe(200);
  });

  it('lets the owner through an override naming every overridable role', async () => {
    const { publicId, owner } = await seed();
    await prisma.channelOverride.createMany({
      data: [
        { channelId: BigInt(publicId), role: 'member', capability: 'view' },
        { channelId: BigInt(publicId), role: 'moderator', capability: 'view' },
      ],
    });

    const response = await owner.get(`/channels/${publicId}`);

    // A channel cannot lock its server's owner out, by any combination of
    // rows it is able to hold (PRD section 5).
    expect(response.status).toBe(200);
  });

  it('404s for someone who is not in the channel’s server', async () => {
    const { publicId } = await seed();
    await resetLoginBudget();
    const outsider = await loggedInAgent(app, OUTSIDER);

    const response = await outsider.get(`/channels/${publicId}`);

    expect(response.status).toBe(404);
  });

  it('gives every hidden case a body identical to the unknown-channel 404', async () => {
    const { privateId, publicId, member } = await seed();
    await prisma.channelOverride.create({
      data: {
        channelId: BigInt(publicId),
        role: 'member',
        capability: 'view',
      },
    });
    const MISSING_ID = '999000000000000008';

    const hiddenPrivate = errorOf(
      (await member.get(`/channels/${privateId}`)).body,
    );
    const hiddenByOverride = errorOf(
      (await member.get(`/channels/${publicId}`)).body,
    );
    const missing = errorOf((await member.get(`/channels/${MISSING_ID}`)).body);

    // The only thing that may differ between these three is the channelId
    // echoed back in `details`, which the caller supplied in the URL and so
    // already knows. Anything else -- a different code, message, or detail
    // key -- would make the 404 an existence oracle again, and "fully
    // hidden" would not actually hold.
    for (const [error, channelId] of [
      [hiddenPrivate, privateId],
      [hiddenByOverride, publicId],
      [missing, MISSING_ID],
    ] as const) {
      expect(error.code).toBe(missing.code);
      expect(error.message).toBe(missing.message);
      expect(error.details).toEqual({ channelId });
    }
  });

  it('401s without a session', async () => {
    const { publicId } = await seed();

    const response = await request(app.getHttpServer()).get(
      `/channels/${publicId}`,
    );

    expect(response.status).toBe(401);
  });

  it('400s for a channelId that is not a Snowflake', async () => {
    const { member } = await seed();

    const response = await member.get('/channels/not-a-snowflake');

    expect(response.status).toBe(400);
  });
});
