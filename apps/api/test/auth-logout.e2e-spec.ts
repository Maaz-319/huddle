import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const GITHUB_USER_ID = 990033;
const GITHUB_LOGIN = 'octocat-logout-e2e';
const GITHUB_EMAIL = 'octocat-logout-e2e@example.com';

function stubGithubExchange(): void {
  nock('https://github.com')
    .post('/login/oauth/access_token')
    .reply(200, { access_token: 'test-access-token', token_type: 'bearer' });

  nock('https://api.github.com').get('/user').reply(200, {
    id: GITHUB_USER_ID,
    login: GITHUB_LOGIN,
    name: 'The Octocat',
    avatar_url: 'https://avatars.example.com/3',
  });

  nock('https://api.github.com')
    .get('/user/emails')
    .reply(200, [{ email: GITHUB_EMAIL, primary: true, verified: true }]);
}

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

/** Logs in a fresh agent via the #31 OAuth flow, returning it with a live session cookie. */
async function loggedInAgent(
  app: INestApplication<App>,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app.getHttpServer());
  const initial = await agent.get('/auth/github');
  stubGithubExchange();
  await agent.get(
    `/auth/github/callback?code=test-code&state=${extractState(initial.headers.location)}`,
  );
  return agent;
}

describe('POST /auth/logout, DELETE /auth/me (e2e)', () => {
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
    await prisma.user.deleteMany({
      where: { githubId: String(GITHUB_USER_ID) },
    });

    const keys = await redis.keys('huddle:rl:*');
    if (keys.length > 0) await redis.del(...keys);

    // Session keys are deliberately not swept here: this spec's own
    // `POST /auth/logout` and `DELETE /auth/me` tests already destroy the
    // sessions they create, and e2e spec files run in parallel against the
    // same Redis instance — a broad `huddle:sess:*` delete would race and
    // destroy another spec file's still-live session out from under it.
    // Anything left over expires on its own via the cookie's rolling TTL.

    nock.cleanAll();
  });

  it('destroys only the current session on logout', async () => {
    const agent = await loggedInAgent(app);

    const logout = await agent.post('/auth/logout');
    expect(logout.status).toBe(204);

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(401);
    expect(me.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects an unauthenticated logout with 401', async () => {
    const response = await request(app.getHttpServer()).post('/auth/logout');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it("deletes the account and invalidates every live session, not just the caller's", async () => {
    const agentA = await loggedInAgent(app);
    const agentB = await loggedInAgent(app);

    const deleteResponse = await agentA.delete('/auth/me');
    expect(deleteResponse.status).toBe(204);

    const meA = await agentA.get('/auth/me');
    expect(meA.status).toBe(401);

    const meB = await agentB.get('/auth/me');
    expect(meB.status).toBe(401);
  });

  it('rejects an unauthenticated account deletion with 401', async () => {
    const response = await request(app.getHttpServer()).delete('/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });
});
