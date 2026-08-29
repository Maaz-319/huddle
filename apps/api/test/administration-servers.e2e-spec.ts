import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990044,
  login: 'octocat-servers-e2e-owner',
  email: 'octocat-servers-e2e-owner@example.com',
};

const OUTSIDER = {
  githubId: 990045,
  login: 'octocat-servers-e2e-outsider',
  email: 'octocat-servers-e2e-outsider@example.com',
};

function stubGithubExchange(fixture: typeof OWNER): void {
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

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

/** Logs in a fresh agent via the #31 OAuth flow, returning it with a live session cookie. */
async function loggedInAgent(
  app: INestApplication<App>,
  fixture: typeof OWNER,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app.getHttpServer());
  const initial = await agent.get('/auth/github');
  stubGithubExchange(fixture);
  await agent.get(
    `/auth/github/callback?code=test-code&state=${extractState(initial.headers.location)}`,
  );
  return agent;
}

describe('POST/GET /servers (e2e)', () => {
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
    // Membership/Server rows this spec created cascade from the User rows
    // that own them via Server's own Cascade — but Membership.user is
    // Restrict, so deleting the Server first, then the Users, is required.
    await prisma.server.deleteMany({ where: { memberships: { some: { user: { githubId: { in: [String(OWNER.githubId), String(OUTSIDER.githubId)] } } } } } });
    await prisma.user.deleteMany({
      where: { githubId: { in: [String(OWNER.githubId), String(OUTSIDER.githubId)] } },
    });

    const keys = await redis.keys('huddle:rl:*');
    if (keys.length > 0) await redis.del(...keys);

    // Session keys deliberately not swept — see auth-logout.e2e-spec.ts's
    // own comment on why a broad huddle:sess:* delete would race other spec
    // files under Jest's parallel spec-file execution.

    nock.cleanAll();
  });

  it('rejects an unauthenticated POST /servers with 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/servers')
      .send({ name: 'General Chat' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('creates a server, seats the creator as owner, and it appears in GET /servers and GET /servers/:id', async () => {
    const owner = await loggedInAgent(app, OWNER);

    const create = await owner
      .post('/servers')
      .send({ name: '  General Chat  ', iconUrl: 'https://example.test/icon.png' });

    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({
      id: expect.any(String) as string,
      name: 'General Chat',
      iconUrl: 'https://example.test/icon.png',
      channelCreationPolicy: 'everyone',
      memberInviteToggle: true,
    });

    const list = await owner.get('/servers');
    expect(list.status).toBe(200);
    expect(list.body).toContainEqual(create.body);

    const detail = await owner.get(`/servers/${create.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual(create.body);
  });

  it("a different user's GET /servers/:id gets 404, not 403", async () => {
    const owner = await loggedInAgent(app, OWNER);
    const outsider = await loggedInAgent(app, OUTSIDER);

    const create = await owner.post('/servers').send({ name: 'Private Server' });

    const detail = await outsider.get(`/servers/${create.body.id}`);

    expect(detail.status).toBe(404);
    expect(detail.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('rejects a server name over 100 characters with a 400', async () => {
    const owner = await loggedInAgent(app, OWNER);

    const response = await owner.post('/servers').send({ name: 'a'.repeat(101) });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('rejects GET /servers/:id for an id nobody holds with 404', async () => {
    const owner = await loggedInAgent(app, OWNER);

    const response = await owner.get('/servers/999000000000000001');

    expect(response.status).toBe(404);
  });
});
