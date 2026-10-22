import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { RATE_LIMIT_POLICIES } from '../src/rate-limiter/rate-limit-policies';

const GITHUB_USER_ID = 990011;
const GITHUB_LOGIN = 'octocat-e2e';
const GITHUB_EMAIL = 'octocat-e2e@example.com';

function stubGithubExchange(overrides?: {
  login?: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
}): void {
  nock('https://github.com')
    .post('/login/oauth/access_token')
    .reply(200, { access_token: 'test-access-token', token_type: 'bearer' });

  nock('https://api.github.com')
    .get('/user')
    .reply(200, {
      id: GITHUB_USER_ID,
      login: overrides?.login ?? GITHUB_LOGIN,
      name: overrides?.name ?? 'The Octocat',
      avatar_url: overrides?.avatarUrl ?? 'https://avatars.example.com/1',
    });

  nock('https://api.github.com')
    .get('/user/emails')
    .reply(200, [
      {
        email: overrides?.email ?? GITHUB_EMAIL,
        primary: true,
        verified: true,
      },
    ]);
}

/** Pulls the `state` passport-oauth2 generated out of the redirect Location. */
function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

describe('GitHub OAuth login (e2e)', () => {
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
    // This suite is the one e2e spec that touches Postgres, against whatever
    // database DATABASE_URL points at locally — clean up exactly the rows it
    // created rather than truncating a shared dev database.
    await prisma.user.deleteMany({
      where: { githubId: String(GITHUB_USER_ID) },
    });

    const keys = await redis.keys('huddle:rl:auth-ip:*');
    if (keys.length > 0) await redis.del(...keys);

    nock.cleanAll();
  });

  it('redirects GET /auth/github to GitHub with client_id, scope, and state', async () => {
    const response = await request(app.getHttpServer()).get('/auth/github');

    expect(response.status).toBe(302);
    const location = new URL(response.headers.location);
    expect(location.origin).toBe('https://github.com');
    expect(location.pathname).toBe('/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBeTruthy();
    // passport-github2 defaults its scope separator to ',', unlike
    // passport-oauth2's own default of a space.
    expect(location.searchParams.get('scope')).toBe('read:user,user:email');
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('provisions a new user on first login and sets a session cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    const initial = await agent.get('/auth/github');
    const state = extractState(initial.headers.location);

    stubGithubExchange();

    const callback = await agent.get(
      `/auth/github/callback?code=test-code&state=${state}`,
    );

    expect(callback.status).toBe(302);
    // The web app is served under /app (auth.controller.ts).
    expect(callback.headers.location).toBe(`${process.env['WEB_ORIGIN']}/app`);
    expect(callback.headers['set-cookie']).toBeDefined();

    const user = await prisma.user.findUnique({
      where: { githubId: String(GITHUB_USER_ID) },
    });
    expect(user).not.toBeNull();
    expect(user?.username).toBe(GITHUB_LOGIN);
    expect(user?.email).toBe(GITHUB_EMAIL);
  });

  it('re-syncs an existing user on a later login rather than duplicating', async () => {
    const first = request.agent(app.getHttpServer());
    const firstInitial = await first.get('/auth/github');
    stubGithubExchange();
    await first.get(
      `/auth/github/callback?code=c1&state=${extractState(firstInitial.headers.location)}`,
    );

    const second = request.agent(app.getHttpServer());
    const secondInitial = await second.get('/auth/github');
    stubGithubExchange({ login: 'octocat-e2e-renamed' });
    await second.get(
      `/auth/github/callback?code=c2&state=${extractState(secondInitial.headers.location)}`,
    );

    const users = await prisma.user.findMany({
      where: { githubId: String(GITHUB_USER_ID) },
    });
    expect(users).toHaveLength(1);
    expect(users[0]?.username).toBe('octocat-e2e-renamed');
  });

  it('redirects to WEB_ORIGIN with an error indicator on a denied callback, without setting a cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    const initial = await agent.get('/auth/github');
    const state = extractState(initial.headers.location);

    const callback = await agent.get(
      `/auth/github/callback?error=access_denied&state=${state}`,
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe(
      `${process.env['WEB_ORIGIN']}/app?error=oauth_failed`,
    );

    const user = await prisma.user.findUnique({
      where: { githubId: String(GITHUB_USER_ID) },
    });
    expect(user).toBeNull();
  });

  it('rate-limits GET /auth/github per IP', async () => {
    const capacity = RATE_LIMIT_POLICIES['auth-ip'].capacity;

    for (let i = 0; i < capacity; i += 1) {
      await request(app.getHttpServer()).get('/auth/github');
    }

    const response = await request(app.getHttpServer()).get('/auth/github');

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
  });
});
