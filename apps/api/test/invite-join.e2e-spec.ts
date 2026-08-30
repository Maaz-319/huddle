import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';

const OWNER = {
  githubId: 990056,
  login: 'octocat-join-e2e-owner',
  email: 'octocat-join-e2e-owner@example.com',
};

const JOINER = {
  githubId: 990057,
  login: 'octocat-join-e2e-joiner',
  email: 'octocat-join-e2e-joiner@example.com',
};

const THIRD = {
  githubId: 990058,
  login: 'octocat-join-e2e-third',
  email: 'octocat-join-e2e-third@example.com',
};

const FIXTURES = [OWNER, JOINER, THIRD];

/** A well-formed code drawn from the real alphabet that nobody holds. */
const UNKNOWN_CODE = 'ZZZZZZZZZZ';

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

function codeOf(body: unknown): string {
  return (body as { code: string }).code;
}

function extractState(location: string): string {
  const state = new URL(location).searchParams.get('state');
  if (state === null) throw new Error('No state param on the redirect');
  return state;
}

describe('/invites (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;

  /** See `administration-invites.e2e-spec.ts` — `auth-ip` allows 5 tokens, a login spends 2. */
  async function resetLoginBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:auth-ip:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  /** Clears the shared strict-mutation budget so a test's own calls are not throttled. */
  async function resetMutationBudget(): Promise<void> {
    const keys = await redis.keys('huddle:rl:strict-mutation:*');
    if (keys.length > 0) await redis.del(...keys);
  }

  async function loggedInAgent(
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
    const githubIds = FIXTURES.map((f) => String(f.githubId));

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

  /** OWNER's server plus its live invite code. */
  async function seedServer(owner: ReturnType<typeof request.agent>): Promise<{
    serverId: string;
    code: string;
  }> {
    const create = await owner.post('/servers').send({ name: 'Huddle HQ' });
    const serverId = idOf(create.body);
    const invite = await owner.get(`/servers/${serverId}/invite`);

    return { serverId, code: codeOf(invite.body) };
  }

  it('previews only the server id, name and iconUrl', async () => {
    const owner = await loggedInAgent(OWNER);
    const { serverId, code } = await seedServer(owner);

    const preview = await owner.get(`/invites/${code}`);

    expect(preview.status).toBe(200);
    // Nothing beyond these three: a code holder is not yet a member and
    // should not learn member counts, the channel list, or who owns it.
    expect(preview.body).toEqual({
      server: { id: serverId, name: 'Huddle HQ', iconUrl: null },
    });
  });

  it('seats the joiner as a member, and the server appears in their GET /servers', async () => {
    const owner = await loggedInAgent(OWNER);
    const { serverId, code } = await seedServer(owner);
    await resetLoginBudget();
    const joiner = await loggedInAgent(JOINER);

    const join = await joiner.post(`/invites/${code}/join`);

    expect(join.status).toBe(200);
    expect(join.body).toMatchObject({ server: { id: serverId } });

    const mine = await joiner.get('/servers');
    expect(mine.status).toBe(200);
    expect(mine.body).toContainEqual(
      expect.objectContaining({ id: serverId }) as object,
    );

    const membership = await prisma.membership.findFirstOrThrow({
      where: {
        serverId: BigInt(serverId),
        user: { githubId: String(JOINER.githubId) },
      },
    });
    expect(membership.role).toBe('member');
  });

  it('joining twice returns 200 both times and leaves exactly one membership row', async () => {
    const owner = await loggedInAgent(OWNER);
    const { serverId, code } = await seedServer(owner);
    await resetLoginBudget();
    const joiner = await loggedInAgent(JOINER);

    const first = await joiner.post(`/invites/${code}/join`);
    const second = await joiner.post(`/invites/${code}/join`);

    // A double-clicked join button is not a failure condition -- never a 409.
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const joinerUser = await prisma.user.findUniqueOrThrow({
      where: { githubId: String(JOINER.githubId) },
    });
    await expect(
      prisma.membership.count({
        where: { serverId: BigInt(serverId), userId: joinerUser.id },
      }),
    ).resolves.toBe(1);
  });

  it('a revoked code and an unknown code produce byte-identical 404 bodies', async () => {
    const owner = await loggedInAgent(OWNER);
    const { serverId, code } = await seedServer(owner);
    await owner.delete(`/servers/${serverId}/invite`);

    const revoked = await owner.get(`/invites/${code}`);
    const unknown = await owner.get(`/invites/${UNKNOWN_CODE}`);

    expect(revoked.status).toBe(404);
    expect(unknown.status).toBe(404);
    // Compared to each other, not just each against 404: any difference makes
    // the endpoint an oracle for which codes used to be valid.
    expect(JSON.stringify(revoked.body)).toBe(JSON.stringify(unknown.body));
  });

  it('rejects a malformed code before any repository call', async () => {
    const owner = await loggedInAgent(OWNER);

    // Both fail in the pipe, before the handler runs, so neither costs a
    // query. `0` and `I` are outside the alphabet; the second is too short.
    const badAlphabet = await owner.get('/invites/ABCDEFGHI0');
    const badLength = await owner.get('/invites/ABCDEFGHJ');

    expect(badAlphabet.status).toBe(400);
    // BAD_REQUEST, not VALIDATION_FAILED: the pipe raises Nest's own
    // BadRequestException, which DomainExceptionFilter renders under its own
    // code -- same as ParseSnowflakePipe.
    expect(badAlphabet.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    expect(badLength.status).toBe(400);
  });

  it('requires a session for both routes', async () => {
    const anonymous = request(app.getHttpServer());

    const preview = await anonymous.get(`/invites/${UNKNOWN_CODE}`);
    const join = await anonymous.post(`/invites/${UNKNOWN_CODE}/join`);

    // The preview is not public: joining needs an identity, and so does
    // deciding whether to.
    expect(preview.status).toBe(401);
    expect(join.status).toBe(401);
  });

  it('PRD section 9 invite lifecycle: join, regenerate, old code dies, new code admits', async () => {
    const owner = await loggedInAgent(OWNER);
    const { serverId, code: originalCode } = await seedServer(owner);

    await resetLoginBudget();
    const joiner = await loggedInAgent(JOINER);
    const joined = await joiner.post(`/invites/${originalCode}/join`);
    expect(joined.status).toBe(200);

    await resetMutationBudget();
    const regenerated = await owner.post(
      `/servers/${serverId}/invite/regenerate`,
    );
    expect(regenerated.status).toBe(200);
    const newCode = codeOf(regenerated.body);
    expect(newCode).not.toBe(originalCode);

    // The old link stops working immediately -- PRD FR-8.
    const stale = await joiner.get(`/invites/${originalCode}`);
    expect(stale.status).toBe(404);

    await resetLoginBudget();
    const third = await loggedInAgent(THIRD);
    await resetMutationBudget();
    const thirdJoin = await third.post(`/invites/${newCode}/join`);
    expect(thirdJoin.status).toBe(200);

    // Owner, the first joiner, and the third user: three members, one server.
    await expect(
      prisma.membership.count({ where: { serverId: BigInt(serverId) } }),
    ).resolves.toBe(3);
  });
});
