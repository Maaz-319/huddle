import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { SnowflakeService } from '../src/common/snowflake.service';
import { User } from '../src/generated/prisma/client';

const OWNER = {
  githubId: 990046,
  login: 'octocat-members-e2e-owner',
  email: 'octocat-members-e2e-owner@example.com',
};

const MEMBER = {
  githubId: 990047,
  login: 'octocat-members-e2e-member',
  email: 'octocat-members-e2e-member@example.com',
};

const MODERATOR = {
  githubId: 990048,
  login: 'octocat-members-e2e-moderator',
  email: 'octocat-members-e2e-moderator@example.com',
};

const FIXTURES = [OWNER, MEMBER, MODERATOR];

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

/** The `id` field off a `POST /servers` response body. */
function idOf(body: unknown): string {
  return (body as { id: string }).id;
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

/**
 * Inserts a `User` row directly, without a live session, for a fixture that
 * only needs to exist as a membership target in these tests -- not to make
 * requests itself. `auth-ip`'s rate limit budget (5/min) can't absorb more
 * than two real OAuth logins per test, so a third participant goes through
 * Prisma instead of `loggedInAgent`.
 */
function createPassiveUser(
  prisma: PrismaService,
  snowflakes: SnowflakeService,
  fixture: (typeof FIXTURES)[number],
): Promise<User> {
  return prisma.user.create({
    data: {
      id: snowflakes.generate(),
      githubId: String(fixture.githubId),
      username: fixture.login,
      avatarUrl: 'https://avatars.example.com/4',
      email: fixture.email,
    },
  });
}

describe('PATCH /servers/:serverId/members/:userId/role (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let snowflakes: SnowflakeService;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = moduleFixture.get(PrismaService);
    redis = moduleFixture.get(RedisService);
    snowflakes = moduleFixture.get(SnowflakeService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    nock.enableNetConnect();
  });

  afterEach(async () => {
    const githubIds = FIXTURES.map((f) => String(f.githubId));

    await prisma.server.deleteMany({
      where: {
        memberships: { some: { user: { githubId: { in: githubIds } } } },
      },
    });
    await prisma.user.deleteMany({
      where: { githubId: { in: githubIds } },
    });

    const keys = await redis.keys('huddle:rl:*');
    if (keys.length > 0) await redis.del(...keys);

    nock.cleanAll();
  });

  it('lets the owner promote a member to moderator, then demote back', async () => {
    const owner = await loggedInAgent(app, OWNER);

    const create = await owner.post('/servers').send({ name: 'Promotions' });
    const serverId = idOf(create.body);

    const memberUser = await createPassiveUser(prisma, snowflakes, MEMBER);
    await prisma.membership.create({
      data: {
        serverId: BigInt(serverId),
        userId: memberUser.id,
        role: 'member',
      },
    });

    const promote = await owner
      .patch(`/servers/${serverId}/members/${memberUser.id}/role`)
      .send({ role: 'moderator' });

    expect(promote.status).toBe(200);
    expect(promote.body).toMatchObject({
      userId: memberUser.id.toString(),
      role: 'moderator',
    });

    const demote = await owner
      .patch(`/servers/${serverId}/members/${memberUser.id}/role`)
      .send({ role: 'member' });

    expect(demote.status).toBe(200);
    expect(demote.body).toMatchObject({
      userId: memberUser.id.toString(),
      role: 'member',
    });
  });

  it('rejects a moderator attempting to promote someone with 403', async () => {
    const owner = await loggedInAgent(app, OWNER);
    const moderator = await loggedInAgent(app, MODERATOR);

    const create = await owner.post('/servers').send({ name: 'Guarded' });
    const serverId = idOf(create.body);

    const moderatorUser = await prisma.user.findUniqueOrThrow({
      where: { githubId: String(MODERATOR.githubId) },
    });
    const memberUser = await createPassiveUser(prisma, snowflakes, MEMBER);
    await prisma.membership.create({
      data: {
        serverId: BigInt(serverId),
        userId: moderatorUser.id,
        role: 'moderator',
      },
    });
    await prisma.membership.create({
      data: {
        serverId: BigInt(serverId),
        userId: memberUser.id,
        role: 'member',
      },
    });

    const response = await moderator
      .patch(`/servers/${serverId}/members/${memberUser.id}/role`)
      .send({ role: 'moderator' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it("rejects 'demoting' the server's owner via this route with 400", async () => {
    const owner = await loggedInAgent(app, OWNER);

    const create = await owner.post('/servers').send({ name: 'Untouchable' });
    const serverId = idOf(create.body);

    const ownerUser = await prisma.user.findUniqueOrThrow({
      where: { githubId: String(OWNER.githubId) },
    });

    const response = await owner
      .patch(`/servers/${serverId}/members/${ownerUser.id}/role`)
      .send({ role: 'member' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('rejects a target who is not a member of the server with 404', async () => {
    const owner = await loggedInAgent(app, OWNER);

    const create = await owner.post('/servers').send({ name: 'Exclusive' });
    const serverId = idOf(create.body);

    const outsiderUser = await createPassiveUser(prisma, snowflakes, MEMBER);

    const response = await owner
      .patch(`/servers/${serverId}/members/${outsiderUser.id}/role`)
      .send({ role: 'moderator' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('rejects an invalid role value with 400', async () => {
    const owner = await loggedInAgent(app, OWNER);

    const create = await owner.post('/servers').send({ name: 'Strict' });
    const serverId = idOf(create.body);

    const ownerUser = await prisma.user.findUniqueOrThrow({
      where: { githubId: String(OWNER.githubId) },
    });

    const response = await owner
      .patch(`/servers/${serverId}/members/${ownerUser.id}/role`)
      .send({ role: 'owner' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});
