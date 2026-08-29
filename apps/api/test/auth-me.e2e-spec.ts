import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const GITHUB_USER_ID = 990022;
const GITHUB_LOGIN = 'octocat-me-e2e';
const GITHUB_EMAIL = 'octocat-me-e2e@example.com';

function stubGithubExchange(): void {
  nock('https://github.com')
    .post('/login/oauth/access_token')
    .reply(200, { access_token: 'test-access-token', token_type: 'bearer' });

  nock('https://api.github.com').get('/user').reply(200, {
    id: GITHUB_USER_ID,
    login: GITHUB_LOGIN,
    name: 'The Octocat',
    avatar_url: 'https://avatars.example.com/2',
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

describe('GET/PATCH /auth/me (e2e)', () => {
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

    nock.cleanAll();
  });

  it('rejects an unauthenticated GET /auth/me with 401', async () => {
    const response = await request(app.getHttpServer()).get('/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('returns the caller on an authenticated GET /auth/me', async () => {
    const agent = await loggedInAgent(app);

    const response = await agent.get('/auth/me');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: expect.any(String) as string,
      username: GITHUB_LOGIN,
      email: GITHUB_EMAIL,
      bio: null,
    });
  });

  it('updates the bio and a follow-up GET reflects it', async () => {
    const agent = await loggedInAgent(app);

    const patch = await agent.patch('/auth/me').send({ bio: 'Hello, world.' });
    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({ bio: 'Hello, world.' });

    const get = await agent.get('/auth/me');
    expect(get.body).toMatchObject({ bio: 'Hello, world.' });
  });

  it('leaves the bio unchanged when the field is omitted', async () => {
    const agent = await loggedInAgent(app);
    await agent.patch('/auth/me').send({ bio: 'Hello, world.' });

    const patch = await agent.patch('/auth/me').send({});

    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({ bio: 'Hello, world.' });
  });

  it('rejects a bio over 300 characters with a 400', async () => {
    const agent = await loggedInAgent(app);

    const response = await agent
      .patch('/auth/me')
      .send({ bio: 'a'.repeat(301) });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});
